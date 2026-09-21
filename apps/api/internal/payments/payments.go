// Package payments turns money into access.
//
// It owns two records and nothing else: payment_transactions (what was charged) and
// payment_callbacks (what the provider told us). Deciding what a learner may then do is
// internal/subscriptions' job, and this package reaches it through one narrow call —
// Activate — so adding a second provider never touches entitlement logic.
//
// What this package must never hold: card numbers, CVVs, expiry dates. Click collects
// those on its own page and sends us identifiers. There is no code path here that accepts
// them, and there must never be one.
//
// The provider interface is deliberately small. A provider has to do exactly two things:
// tell the learner where to pay, and tell us afterwards whether they did.
package payments

import (
	"context"
	"errors"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/samandar-hodiev/engora/apps/api/internal/audit"
	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/internal/subscriptions"
	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/httpx"
)

// Transaction statuses.
const (
	StatusCreated  = "created"
	StatusPrepared = "prepared"
	StatusPaid     = "paid"
	StatusCanceled = "canceled"
	StatusFailed   = "failed"
)

const (
	AuditCheckout = "payment.checkout_created"
	AuditPaid     = "payment.paid"
	AuditCanceled = "payment.canceled"
)

// Plans is the slice of internal/subscriptions this package needs.
type Plans interface {
	PlanByCode(ctx context.Context, code string) (subscriptions.Plan, error)
	Activate(ctx context.Context, in subscriptions.Activation) (uuid.UUID, error)
}

// Notifier is told when a payment succeeds. Optional: a missing notifier must never stop
// a payment from being recorded.
type Notifier interface {
	Notify(ctx context.Context, userID uuid.UUID, templateCode string, vars map[string]any) error
}

// Provider is implemented once per billing provider.
type Provider interface {
	Name() string
	// Checkout returns where to send the learner to pay for the transaction.
	Checkout(tx Transaction, plan subscriptions.Plan) (string, error)
	// RegisterCallbacks mounts the provider's server-to-server endpoints. They are public:
	// the provider signs its requests and the handler verifies that signature. The module
	// is passed in rather than injected at construction so a provider cannot exist without
	// the ledger it writes to.
	RegisterCallbacks(g *gin.RouterGroup, m *Module)
}

type Module struct {
	pool     *pgxpool.Pool
	plans    Plans
	provider Provider
	audit    audit.Recorder
	notify   Notifier
}

type Deps struct {
	Pool     *pgxpool.Pool
	Plans    Plans
	Provider Provider
	Audit    audit.Recorder
	Notifier Notifier
}

func NewModule(d Deps) *Module {
	return &Module{pool: d.Pool, plans: d.Plans, provider: d.Provider, audit: d.Audit, notify: d.Notifier}
}

func (m *Module) RegisterRoutes(v1 *gin.RouterGroup) {
	g := v1.Group("/payments")
	g.GET("/methods", m.methods)
	g.POST("/checkout", authz.RequireAuthenticated(), m.checkout)
	g.GET("/transactions", authz.RequireAuthenticated(), m.transactions)
	if m.provider != nil {
		m.provider.RegisterCallbacks(g, m)
	}
}

// Transaction is one attempt to pay for one plan.
type Transaction struct {
	ID          uuid.UUID  `json:"id"`
	UserID      uuid.UUID  `json:"-"`
	PlanID      uuid.UUID  `json:"plan_id"`
	PlanCode    string     `json:"plan_code"`
	PlanName    string     `json:"plan_name"`
	Provider    string     `json:"provider"`
	Status      string     `json:"status"`
	AmountMinor int64      `json:"amount_minor"`
	Currency    string     `json:"currency"`
	PrepareID   *int64     `json:"-"`
	ErrorNote   string     `json:"error_note,omitempty"`
	PaidAt      *time.Time `json:"paid_at"`
	CreatedAt   time.Time  `json:"created_at"`
}

type checkoutInput struct {
	PlanCode string `json:"plan_code" binding:"required,min=2,max=64"`
}

type checkoutOutput struct {
	TransactionID uuid.UUID `json:"transaction_id"`
	Provider      string    `json:"provider"`
	URL           string    `json:"url"`
	AmountMinor   int64     `json:"amount_minor"`
	Currency      string    `json:"currency"`
}

// methods tells the client whether checkout is available at all, so the billing page can
// say "payment is not configured" instead of offering a button that fails.
func (m *Module) methods(c *gin.Context) {
	if m.provider == nil {
		httpx.OK(c, gin.H{"provider": nil, "available": false})
		return
	}
	httpx.OK(c, gin.H{"provider": m.provider.Name(), "available": true})
}

func (m *Module) checkout(c *gin.Context) {
	p, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	var in checkoutInput
	if err := httpx.BindJSON(c, &in); err != nil {
		httpx.Fail(c, err)
		return
	}
	if m.provider == nil {
		httpx.Fail(c, apperr.New(apperr.CodeUnavailable, "Online payment is not available yet"))
		return
	}
	ctx := c.Request.Context()

	plan, err := m.plans.PlanByCode(ctx, in.PlanCode)
	if err != nil {
		if errors.Is(err, subscriptions.ErrPlanNotFound) {
			httpx.Fail(c, apperr.NotFound("Plan"))
			return
		}
		httpx.Fail(c, err)
		return
	}
	amount, currency, err := m.price(ctx, plan)
	if err != nil {
		httpx.Fail(c, err)
		return
	}

	tx := Transaction{
		ID: uuid.New(), UserID: p.UserID, PlanID: plan.ID, PlanCode: plan.Code, PlanName: plan.Name,
		Provider: m.provider.Name(), Status: StatusCreated, AmountMinor: amount, Currency: currency,
	}
	if _, err := m.pool.Exec(ctx, `
		INSERT INTO payment_transactions (id, user_id, plan_id, provider, status, amount_minor, currency)
		VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		tx.ID, tx.UserID, tx.PlanID, tx.Provider, tx.Status, tx.AmountMinor, tx.Currency); err != nil {
		httpx.Fail(c, err)
		return
	}

	url, err := m.provider.Checkout(tx, plan)
	if err != nil {
		httpx.Fail(c, apperr.Wrap(err, apperr.CodeUnavailable, "Online payment is not available right now"))
		return
	}
	if m.audit != nil {
		m.audit.Record(ctx, audit.Entry{
			ActorID: &p.UserID, Action: AuditCheckout, EntityType: "payment_transaction", EntityID: tx.ID.String(),
			Metadata: map[string]any{"plan": plan.Code, "amount_minor": amount, "currency": currency, "provider": tx.Provider},
			IP:       c.ClientIP(), UserAgent: c.Request.UserAgent(),
		})
	}
	httpx.Created(c, checkoutOutput{TransactionID: tx.ID, Provider: tx.Provider, URL: url, AmountMinor: amount, Currency: currency})
}

// price is what this plan costs through the configured provider.
//
// Click bills in so'm only. A plan that has no so'm price is not an error in the plan —
// it may be sold elsewhere — so the message says what the owner has to do rather than
// pretending the plan does not exist.
func (m *Module) price(ctx context.Context, plan subscriptions.Plan) (int64, string, error) {
	if m.provider != nil && m.provider.Name() == ProviderClick {
		var uzs *int64
		if err := m.pool.QueryRow(ctx, `SELECT price_uzs FROM subscription_plans WHERE id = $1`, plan.ID).Scan(&uzs); err != nil {
			return 0, "", err
		}
		if uzs == nil || *uzs <= 0 {
			return 0, "", apperr.New(apperr.CodeUnavailable, "This plan is not available for payment in so'm yet").
				WithDetails(map[string]any{"plan": plan.Code})
		}
		return *uzs * 100, "UZS", nil // tiyin
	}
	if plan.PriceCents <= 0 {
		return 0, "", apperr.BadRequest("This plan is free")
	}
	return int64(plan.PriceCents), plan.Currency, nil
}

func (m *Module) transactions(c *gin.Context) {
	p, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	rows, err := m.pool.Query(c.Request.Context(), `
		SELECT t.id, t.plan_id, p.code, p.name, t.provider, t.status, t.amount_minor, t.currency,
		       t.error_note, t.paid_at, t.created_at
		FROM payment_transactions t JOIN subscription_plans p ON p.id = t.plan_id
		WHERE t.user_id = $1 ORDER BY t.created_at DESC LIMIT 50`, p.UserID)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	defer rows.Close()

	list := []Transaction{}
	for rows.Next() {
		var t Transaction
		if err := rows.Scan(&t.ID, &t.PlanID, &t.PlanCode, &t.PlanName, &t.Provider, &t.Status,
			&t.AmountMinor, &t.Currency, &t.ErrorNote, &t.PaidAt, &t.CreatedAt); err != nil {
			httpx.Fail(c, err)
			return
		}
		list = append(list, t)
	}
	if err := rows.Err(); err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, list)
}

// ---- shared transaction operations (used by every provider) --------------------------------

// byID reads a transaction for a provider callback. Returns pgx.ErrNoRows when the
// identifier does not name one of ours.
func (m *Module) byID(ctx context.Context, id uuid.UUID) (Transaction, error) {
	var t Transaction
	err := m.pool.QueryRow(ctx, `
		SELECT t.id, t.user_id, t.plan_id, p.code, p.name, t.provider, t.status, t.amount_minor,
		       t.currency, t.prepare_id
		FROM payment_transactions t JOIN subscription_plans p ON p.id = t.plan_id
		WHERE t.id = $1`, id).
		Scan(&t.ID, &t.UserID, &t.PlanID, &t.PlanCode, &t.PlanName, &t.Provider, &t.Status,
			&t.AmountMinor, &t.Currency, &t.PrepareID)
	return t, err
}

// prepare moves a transaction to `prepared` and gives it the integer identifier the
// provider will quote back on confirmation. Calling it twice returns the same identifier,
// because providers retry.
func (m *Module) prepare(ctx context.Context, id uuid.UUID, providerTransID, providerPaymentID string) (int64, error) {
	var prepareID int64
	err := m.pool.QueryRow(ctx, `
		UPDATE payment_transactions
		SET status = $2,
		    prepare_id = COALESCE(prepare_id, nextval('payment_prepare_id_seq')),
		    provider_trans_id = $3,
		    provider_payment_id = NULLIF($4, ''),
		    prepared_at = COALESCE(prepared_at, now())
		WHERE id = $1 AND status IN ($5, $2)
		RETURNING prepare_id`, id, StatusPrepared, providerTransID, providerPaymentID, StatusCreated).Scan(&prepareID)
	return prepareID, err
}

// claim is a compare-and-set from `prepared` to `paid`. It is the only thing standing
// between a retried callback and a second month of access granted for one payment, so the
// check and the write are one statement.
func (m *Module) claim(ctx context.Context, id uuid.UUID, providerTransID string) (bool, error) {
	tag, err := m.pool.Exec(ctx, `
		UPDATE payment_transactions
		SET status = $2, paid_at = now(), provider_trans_id = $3, error_code = 0, error_note = ''
		WHERE id = $1 AND status = $4`, id, StatusPaid, providerTransID, StatusPrepared)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}

// unclaim puts a transaction back after the claim succeeded but access could not be
// granted, so the provider's retry is handled instead of being answered "already paid".
func (m *Module) unclaim(ctx context.Context, id uuid.UUID, note string) {
	_, _ = m.pool.Exec(ctx, `
		UPDATE payment_transactions SET status = $2, paid_at = NULL, error_note = $3
		WHERE id = $1 AND status = $4`, id, StatusPrepared, note, StatusPaid)
}

func (m *Module) cancel(ctx context.Context, t Transaction, code int, note string) {
	_, _ = m.pool.Exec(ctx, `
		UPDATE payment_transactions
		SET status = $2, canceled_at = now(), error_code = $3, error_note = $4
		WHERE id = $1 AND status <> $5`, t.ID, StatusCanceled, code, note, StatusPaid)
	if m.audit != nil {
		m.audit.Record(ctx, audit.Entry{
			ActorID: &t.UserID, Action: AuditCanceled, EntityType: "payment_transaction", EntityID: t.ID.String(),
			Metadata: map[string]any{"plan": t.PlanCode, "error_code": code, "error_note": note},
		})
	}
}

// recordCallback stores what a provider sent and what we answered. Written for every
// callback including rejected ones: a burst of failed signatures is either a rotated
// secret or somebody probing, and both need to be visible.
func (m *Module) recordCallback(ctx context.Context, provider, action string, txID *uuid.UUID, valid bool, payload, response any) {
	_, _ = m.pool.Exec(ctx, `
		INSERT INTO payment_callbacks (provider, transaction_id, action, signature_valid, payload, response)
		VALUES ($1, $2, $3, $4, $5, $6)`, provider, txID, action, valid, payload, response)
}

// settle grants the access that was paid for.
func (m *Module) settle(ctx context.Context, t Transaction, providerTransID string) error {
	subID, err := m.plans.Activate(ctx, subscriptions.Activation{
		UserID: t.UserID, PlanID: t.PlanID, Provider: t.Provider, ProviderSubscriptionID: providerTransID,
	})
	if err != nil {
		return err
	}
	if _, err := m.pool.Exec(ctx,
		`UPDATE payment_transactions SET subscription_id = $2 WHERE id = $1`, t.ID, subID); err != nil {
		return err
	}
	if m.audit != nil {
		m.audit.Record(ctx, audit.Entry{
			ActorID: &t.UserID, Action: AuditPaid, EntityType: "payment_transaction", EntityID: t.ID.String(),
			Metadata: map[string]any{"plan": t.PlanCode, "amount_minor": t.AmountMinor, "currency": t.Currency,
				"provider": t.Provider, "subscription_id": subID.String()},
		})
	}
	if m.notify != nil {
		// A receipt is nice to have; it is never a reason to fail a payment that succeeded.
		_ = m.notify.Notify(ctx, t.UserID, NotifyPaymentSucceeded, map[string]any{
			"plan":     t.PlanName,
			"amount":   FormatAmount(t.AmountMinor, t.Currency),
			"currency": t.Currency,
		})
	}
	return nil
}

// NotifyPaymentSucceeded is the notification template sent after a successful payment.
const NotifyPaymentSucceeded = "payment_succeeded"

// FormatAmount renders minor units for a human: 12 000 000 tiyin → "120 000".
func FormatAmount(minor int64, currency string) string {
	major := minor / 100
	s := ""
	for major > 0 {
		part := major % 1000
		major /= 1000
		chunk := itoa(part)
		if major > 0 {
			for len(chunk) < 3 {
				chunk = "0" + chunk
			}
			s = " " + chunk + s
		} else {
			s = chunk + s
		}
	}
	if s == "" {
		s = "0"
	}
	return s
}

func itoa(n int64) string {
	if n == 0 {
		return "0"
	}
	var b []byte
	for n > 0 {
		b = append([]byte{byte('0' + n%10)}, b...)
		n /= 10
	}
	return string(b)
}
