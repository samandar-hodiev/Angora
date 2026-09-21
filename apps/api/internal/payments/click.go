package payments

import (
	"crypto/md5"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"net/url"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/samandar-hodiev/engora/apps/api/config"
	"github.com/samandar-hodiev/engora/apps/api/internal/subscriptions"
	"github.com/samandar-hodiev/engora/apps/api/pkg/logger"
)

// ProviderClick is my.click.uz, the card gateway most learners in Uzbekistan already have.
const ProviderClick = "click"

// Click implements the Click Merchant API ("SHOP-API"): the learner pays on Click's own
// page, and Click then calls us twice — Prepare to ask whether the payment may go ahead,
// Complete to tell us it did.
//
// Two properties matter more than anything else here.
//
//   - Every callback is signed with a secret only Click and we know. The signature is
//     checked before the request is allowed to mean anything, and it is compared in
//     constant time, because an unauthenticated "this was paid" endpoint is a way to give
//     away subscriptions.
//   - Callbacks are retried. Both handlers are therefore idempotent, and the one that
//     grants access does so through a compare-and-set, never a read-then-write.
//
// Click expects HTTP 200 with a JSON body for every outcome, including refusals: a
// non-200 makes it retry blindly instead of reading the error code we sent.
type Click struct {
	cfg config.ClickConfig
	web string
	log *slog.Logger
}

func NewClick(cfg config.ClickConfig, webURL string, log *slog.Logger) *Click {
	return &Click{cfg: cfg, web: webURL, log: log}
}

func (cl *Click) Name() string { return ProviderClick }

// Checkout builds the my.click.uz link. transaction_param carries our own transaction id,
// which is what comes back as merchant_trans_id.
func (cl *Click) Checkout(t Transaction, _ subscriptions.Plan) (string, error) {
	if t.Currency != "UZS" {
		return "", fmt.Errorf("click bills in UZS, transaction is %s", t.Currency)
	}
	base, err := url.Parse(cl.cfg.CheckoutURL)
	if err != nil {
		return "", err
	}
	ret := cl.cfg.ReturnURL
	if ret == "" {
		ret = strings.TrimRight(cl.web, "/") + "/app/subscription"
	}
	q := base.Query()
	q.Set("service_id", cl.cfg.ServiceID)
	q.Set("merchant_id", cl.cfg.MerchantID)
	q.Set("amount", formatSum(t.AmountMinor))
	q.Set("transaction_param", t.ID.String())
	q.Set("return_url", ret)
	base.RawQuery = q.Encode()
	return base.String(), nil
}

func (cl *Click) RegisterCallbacks(g *gin.RouterGroup, m *Module) {
	g.POST("/click/prepare", func(c *gin.Context) { cl.handle(c, m, actionPrepare) })
	g.POST("/click/complete", func(c *gin.Context) { cl.handle(c, m, actionComplete) })
}

// Click protocol constants.
const (
	actionPrepare  = "0"
	actionComplete = "1"

	clickOK                 = 0
	clickErrSignCheckFailed = -1
	clickErrBadAmount       = -2
	clickErrActionNotFound  = -3
	clickErrAlreadyPaid     = -4
	clickErrTransNotFound   = -6
	clickErrUpdateFailed    = -7
	clickErrBadRequest      = -8
	clickErrTransCanceled   = -9
)

// clickRequest keeps every field as the string it arrived as: the signature is computed
// over the raw values, so re-formatting a number would break it.
type clickRequest struct {
	ClickTransID      string `form:"click_trans_id" json:"click_trans_id"`
	ServiceID         string `form:"service_id" json:"service_id"`
	ClickPaydocID     string `form:"click_paydoc_id" json:"click_paydoc_id"`
	MerchantTransID   string `form:"merchant_trans_id" json:"merchant_trans_id"`
	MerchantPrepareID string `form:"merchant_prepare_id" json:"merchant_prepare_id"`
	Amount            string `form:"amount" json:"amount"`
	Action            string `form:"action" json:"action"`
	Error             string `form:"error" json:"error"`
	ErrorNote         string `form:"error_note" json:"error_note"`
	SignTime          string `form:"sign_time" json:"sign_time"`
	SignString        string `form:"sign_string" json:"sign_string"`
}

type clickResponse struct {
	ClickTransID      string `json:"click_trans_id"`
	MerchantTransID   string `json:"merchant_trans_id"`
	MerchantPrepareID *int64 `json:"merchant_prepare_id,omitempty"`
	MerchantConfirmID *int64 `json:"merchant_confirm_id,omitempty"`
	Error             int    `json:"error"`
	ErrorNote         string `json:"error_note"`
}

var clickNotes = map[int]string{
	clickOK:                 "Success",
	clickErrSignCheckFailed: "SIGN CHECK FAILED",
	clickErrBadAmount:       "Incorrect parameter amount",
	clickErrActionNotFound:  "Action not found",
	clickErrAlreadyPaid:     "Already paid",
	clickErrTransNotFound:   "Transaction does not exist",
	clickErrUpdateFailed:    "Failed to update user",
	clickErrBadRequest:      "Error in request from click",
	clickErrTransCanceled:   "Transaction cancelled",
}

// handle runs both callbacks; they differ only in what they sign and what they do at the
// end, and keeping them together is what stops one of them from quietly losing a check.
func (cl *Click) handle(c *gin.Context, m *Module, action string) {
	ctx := c.Request.Context()
	log := logger.FromContext(ctx, cl.log)

	var req clickRequest
	if err := c.ShouldBind(&req); err != nil {
		cl.reply(c, m, action, nil, false, req, clickErrBadRequest)
		return
	}

	// Signature first: nothing in the request is trusted until it verifies, including the
	// transaction id we would otherwise use to look a learner up.
	if !cl.verify(req, action) {
		log.Warn("click callback rejected: bad signature",
			slog.String("action", action), slog.String("click_trans_id", req.ClickTransID))
		cl.reply(c, m, action, nil, false, req, clickErrSignCheckFailed)
		return
	}
	if req.Action != action {
		cl.reply(c, m, action, nil, true, req, clickErrActionNotFound)
		return
	}

	id, err := uuid.Parse(req.MerchantTransID)
	if err != nil {
		cl.reply(c, m, action, nil, true, req, clickErrTransNotFound)
		return
	}
	t, err := m.byID(ctx, id)
	if err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			log.Error("click callback: load transaction", slog.String("error", err.Error()))
		}
		cl.reply(c, m, action, nil, true, req, clickErrTransNotFound)
		return
	}

	switch t.Status {
	case StatusPaid:
		cl.reply(c, m, action, &t, true, req, clickErrAlreadyPaid)
		return
	case StatusCanceled:
		cl.reply(c, m, action, &t, true, req, clickErrTransCanceled)
		return
	}

	// Click sends the amount it actually charged. If it disagrees with what we recorded,
	// something is wrong on one side and we refuse rather than guess which.
	if amountMinor(req.Amount) != t.AmountMinor {
		cl.reply(c, m, action, &t, true, req, clickErrBadAmount)
		return
	}

	// A negative error in the request is Click telling us the payment failed on its side.
	if code, err := strconv.Atoi(req.Error); err == nil && code < 0 {
		m.cancel(ctx, t, code, strings.TrimSpace(req.ErrorNote))
		cl.reply(c, m, action, &t, true, req, clickErrTransCanceled)
		return
	}

	if action == actionPrepare {
		prepareID, err := m.prepare(ctx, t.ID, req.ClickTransID, req.ClickPaydocID)
		if err != nil {
			log.Error("click prepare failed", slog.String("error", err.Error()), slog.String("transaction_id", t.ID.String()))
			cl.reply(c, m, action, &t, true, req, clickErrUpdateFailed)
			return
		}
		cl.replyOK(c, m, action, &t, req, &prepareID)
		return
	}

	// Complete. The prepare id has to be the one we issued: it is the second half of the
	// handshake and stops a confirmation for a transaction that was never prepared.
	if t.PrepareID == nil || req.MerchantPrepareID != strconv.FormatInt(*t.PrepareID, 10) {
		cl.reply(c, m, action, &t, true, req, clickErrTransNotFound)
		return
	}
	claimed, err := m.claim(ctx, t.ID, req.ClickTransID)
	if err != nil {
		log.Error("click complete: claim failed", slog.String("error", err.Error()))
		cl.reply(c, m, action, &t, true, req, clickErrUpdateFailed)
		return
	}
	if !claimed {
		// Another callback for the same transaction won the race and is granting access.
		cl.reply(c, m, action, &t, true, req, clickErrAlreadyPaid)
		return
	}
	if err := m.settle(ctx, t, req.ClickTransID); err != nil {
		m.unclaim(ctx, t.ID, "activation failed")
		log.Error("click complete: activation failed",
			slog.String("error", err.Error()), slog.String("transaction_id", t.ID.String()))
		cl.reply(c, m, action, &t, true, req, clickErrUpdateFailed)
		return
	}
	cl.replyOK(c, m, action, &t, req, t.PrepareID)
}

// verify recomputes the signature Click sends. Prepare and Complete sign different fields;
// Complete adds merchant_prepare_id, which is what binds a confirmation to the specific
// prepare it belongs to.
func (cl *Click) verify(req clickRequest, action string) bool {
	if subtle.ConstantTimeCompare([]byte(req.ServiceID), []byte(cl.cfg.ServiceID)) != 1 {
		return false
	}
	parts := []string{req.ClickTransID, req.ServiceID, cl.cfg.SecretKey, req.MerchantTransID}
	if action == actionComplete {
		parts = append(parts, req.MerchantPrepareID)
	}
	parts = append(parts, req.Amount, req.Action, req.SignTime)

	sum := md5.Sum([]byte(strings.Join(parts, ""))) // #nosec G401 -- the algorithm is Click's, not ours
	want := hex.EncodeToString(sum[:])
	return subtle.ConstantTimeCompare([]byte(strings.ToLower(req.SignString)), []byte(want)) == 1
}

func (cl *Click) reply(c *gin.Context, m *Module, action string, t *Transaction, signed bool, req clickRequest, code int) {
	res := clickResponse{
		ClickTransID:    req.ClickTransID,
		MerchantTransID: req.MerchantTransID,
		Error:           code,
		ErrorNote:       clickNotes[code],
	}
	cl.write(c, m, action, t, signed, req, res)
}

func (cl *Click) replyOK(c *gin.Context, m *Module, action string, t *Transaction, req clickRequest, id *int64) {
	res := clickResponse{
		ClickTransID:    req.ClickTransID,
		MerchantTransID: req.MerchantTransID,
		Error:           clickOK,
		ErrorNote:       clickNotes[clickOK],
	}
	if action == actionPrepare {
		res.MerchantPrepareID = id
	} else {
		res.MerchantConfirmID = id
	}
	cl.write(c, m, action, t, true, req, res)
}

func (cl *Click) write(c *gin.Context, m *Module, action string, t *Transaction, signed bool, req clickRequest, res clickResponse) {
	var txID *uuid.UUID
	if t != nil {
		txID = &t.ID
	}
	// The stored payload deliberately omits sign_string: it is a keyed digest of our
	// secret, and there is no reason for it to sit in a table support staff can read.
	m.recordCallback(c.Request.Context(), ProviderClick, action, txID, signed, map[string]any{
		"click_trans_id": req.ClickTransID, "click_paydoc_id": req.ClickPaydocID,
		"merchant_trans_id": req.MerchantTransID, "merchant_prepare_id": req.MerchantPrepareID,
		"amount": req.Amount, "action": req.Action, "error": req.Error,
		"error_note": req.ErrorNote, "sign_time": req.SignTime,
	}, res)
	c.JSON(200, res)
}

// amountMinor converts Click's decimal so'm ("120000.00") to tiyin. An unparsable amount
// becomes -1, which can never equal a stored amount, so it is refused.
func amountMinor(s string) int64 {
	f, err := strconv.ParseFloat(strings.TrimSpace(s), 64)
	if err != nil || f <= 0 || math.IsInf(f, 0) {
		return -1
	}
	return int64(math.Round(f * 100))
}

// formatSum renders tiyin as the decimal so'm Click expects.
func formatSum(minor int64) string {
	return strconv.FormatFloat(float64(minor)/100, 'f', 2, 64)
}
