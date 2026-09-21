package payments

import (
	"bytes"
	"context"
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/samandar-hodiev/engora/apps/api/config"
	"github.com/samandar-hodiev/engora/apps/api/internal/audit"
	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/database"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/middleware"
	"github.com/samandar-hodiev/engora/apps/api/internal/platform/observability"
	"github.com/samandar-hodiev/engora/apps/api/internal/subscriptions"
	"github.com/samandar-hodiev/engora/apps/api/internal/users"
)

// The Click callbacks against PostgreSQL. What is being proved here is not that the happy
// path works — it is that the things which would cost real money cannot happen: an unsigned
// callback granting access, a retried callback granting a second month, a confirmation for
// a transaction that was never prepared, and an amount that does not match. Run with:
//
//	TEST_DATABASE_URL=postgres://localhost:5432/engora_test?sslmode=disable go test -p 1 -run TestClick ./internal/payments/

const (
	testServiceID = "12345"
	testSecret    = "test-secret-key"
)

func sign(parts ...string) string {
	sum := md5.Sum([]byte(strings.Join(parts, "")))
	return hex.EncodeToString(sum[:])
}

func TestClickCallbacksPostgres(t *testing.T) {
	dbURL := os.Getenv("TEST_DATABASE_URL")
	if dbURL == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	if err := database.MigrateUp(dbURL); err != nil {
		t.Fatal(err)
	}
	pool, err := database.Connect(ctx, database.Options{URL: dbURL, MaxConns: 4})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)

	learner, err := users.NewPostgresRepository(pool).CreateAccount(ctx, users.NewAccount{
		Email: fmt.Sprintf("payer-%d@example.com", time.Now().UnixNano()), DisplayName: "Payer", Timezone: "UTC", EmailVerified: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, learner.ID) })

	store := subscriptions.NewPostgresStore(pool)
	click := NewClick(config.ClickConfig{
		ServiceID: testServiceID, MerchantID: "999", SecretKey: testSecret,
		CheckoutURL: "https://my.click.uz/services/pay",
	}, "https://engora.test", slog.New(slog.DiscardHandler))
	module := NewModule(Deps{Pool: pool, Plans: store, Provider: click, Audit: audit.Nop{}})

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(middleware.Errors(observability.LogReporter{Log: slog.New(slog.DiscardHandler)}), func(c *gin.Context) {
		authz.SetPrincipal(c, authz.Principal{UserID: learner.ID, Role: authz.RoleUser, SessionID: uuid.New()})
		c.Next()
	})
	module.RegisterRoutes(r.Group("/api/v1"))

	postJSON := func(path string, body any) (*httptest.ResponseRecorder, map[string]any) {
		t.Helper()
		var buf bytes.Buffer
		_ = json.NewEncoder(&buf).Encode(body)
		req := httptest.NewRequest(http.MethodPost, "/api/v1"+path, &buf)
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		var envelope map[string]any
		_ = json.Unmarshal(w.Body.Bytes(), &envelope)
		return w, envelope
	}

	callback := func(path string, form url.Values) clickResponse {
		t.Helper()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/payments/click/"+path, strings.NewReader(form.Encode()))
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("click must always get HTTP 200, got %d: %s", w.Code, w.Body.String())
		}
		var res clickResponse
		if err := json.Unmarshal(w.Body.Bytes(), &res); err != nil {
			t.Fatalf("decode click response: %v (%s)", err, w.Body.String())
		}
		return res
	}

	// A checkout for every scenario: each one needs its own transaction, because the
	// interesting cases are terminal.
	newCheckout := func(planCode string) (uuid.UUID, string) {
		t.Helper()
		w, body := postJSON("/payments/checkout", map[string]any{"plan_code": planCode})
		if w.Code != http.StatusCreated {
			t.Fatalf("checkout status = %d body = %s", w.Code, w.Body.String())
		}
		data, _ := body["data"].(map[string]any)
		id, err := uuid.Parse(data["transaction_id"].(string))
		if err != nil {
			t.Fatal(err)
		}
		amount := formatSum(int64(data["amount_minor"].(float64)))
		return id, amount
	}

	prepareForm := func(txID uuid.UUID, amount, clickTransID string) url.Values {
		signTime := "2026-09-21 10:00:00"
		f := url.Values{}
		f.Set("click_trans_id", clickTransID)
		f.Set("service_id", testServiceID)
		f.Set("click_paydoc_id", "777")
		f.Set("merchant_trans_id", txID.String())
		f.Set("amount", amount)
		f.Set("action", actionPrepare)
		f.Set("error", "0")
		f.Set("error_note", "Success")
		f.Set("sign_time", signTime)
		f.Set("sign_string", sign(clickTransID, testServiceID, testSecret, txID.String(), amount, actionPrepare, signTime))
		return f
	}

	completeForm := func(txID uuid.UUID, amount, clickTransID, prepareID string) url.Values {
		signTime := "2026-09-21 10:05:00"
		f := url.Values{}
		f.Set("click_trans_id", clickTransID)
		f.Set("service_id", testServiceID)
		f.Set("click_paydoc_id", "777")
		f.Set("merchant_trans_id", txID.String())
		f.Set("merchant_prepare_id", prepareID)
		f.Set("amount", amount)
		f.Set("action", actionComplete)
		f.Set("error", "0")
		f.Set("error_note", "Success")
		f.Set("sign_time", signTime)
		f.Set("sign_string", sign(clickTransID, testServiceID, testSecret, txID.String(), prepareID, amount, actionComplete, signTime))
		return f
	}

	status := func(id uuid.UUID) string {
		var s string
		if err := pool.QueryRow(ctx, `SELECT status FROM payment_transactions WHERE id = $1`, id).Scan(&s); err != nil {
			t.Fatal(err)
		}
		return s
	}

	t.Run("checkout refuses a plan with no som price", func(t *testing.T) {
		w, body := postJSON("/payments/checkout", map[string]any{"plan_code": "free"})
		if w.Code != http.StatusServiceUnavailable {
			t.Fatalf("status = %d body = %s, want 503 for a plan Click cannot bill", w.Code, w.Body.String())
		}
		errObj, _ := body["error"].(map[string]any)
		if code, _ := errObj["code"].(string); code != "SERVICE_UNAVAILABLE" {
			t.Errorf("code = %q, want SERVICE_UNAVAILABLE", code)
		}
	})

	t.Run("checkout returns a click url carrying our transaction id", func(t *testing.T) {
		w, body := postJSON("/payments/checkout", map[string]any{"plan_code": "pro"})
		if w.Code != http.StatusCreated {
			t.Fatalf("status = %d body = %s", w.Code, w.Body.String())
		}
		data, _ := body["data"].(map[string]any)
		raw, _ := data["url"].(string)
		u, err := url.Parse(raw)
		if err != nil {
			t.Fatal(err)
		}
		if got := u.Query().Get("transaction_param"); got != data["transaction_id"] {
			t.Errorf("transaction_param = %q, want the transaction id %v", got, data["transaction_id"])
		}
		if got := u.Query().Get("amount"); got != "49000.00" {
			t.Errorf("amount = %q, want 49000.00 som", got)
		}
		if got := int64(data["amount_minor"].(float64)); got != 4900000 {
			t.Errorf("amount_minor = %d, want 4900000 tiyin", got)
		}
	})

	t.Run("an unsigned callback changes nothing", func(t *testing.T) {
		id, amount := newCheckout("pro")
		f := prepareForm(id, amount, "1001")
		f.Set("sign_string", strings.Repeat("0", 32))
		res := callback("prepare", f)
		if res.Error != clickErrSignCheckFailed {
			t.Fatalf("error = %d, want %d (SIGN CHECK FAILED)", res.Error, clickErrSignCheckFailed)
		}
		if got := status(id); got != StatusCreated {
			t.Errorf("status = %q, want it untouched at %q", got, StatusCreated)
		}
		var recorded bool
		_ = pool.QueryRow(ctx, `
			SELECT signature_valid FROM payment_callbacks WHERE transaction_id IS NULL
			ORDER BY created_at DESC LIMIT 1`).Scan(&recorded)
		if recorded {
			t.Error("a rejected signature must be recorded as invalid")
		}
	})

	t.Run("an amount that disagrees with ours is refused", func(t *testing.T) {
		id, _ := newCheckout("pro")
		res := callback("prepare", prepareForm(id, "1.00", "1002"))
		if res.Error != clickErrBadAmount {
			t.Fatalf("error = %d, want %d (incorrect amount)", res.Error, clickErrBadAmount)
		}
		if got := status(id); got != StatusCreated {
			t.Errorf("status = %q, want it untouched", got)
		}
	})

	t.Run("completing without preparing is refused", func(t *testing.T) {
		id, amount := newCheckout("pro")
		res := callback("complete", completeForm(id, amount, "1003", "424242"))
		if res.Error != clickErrTransNotFound {
			t.Fatalf("error = %d, want %d — a confirmation must name a prepare we issued", res.Error, clickErrTransNotFound)
		}
		if got := status(id); got != StatusCreated {
			t.Errorf("status = %q, want it untouched", got)
		}
	})

	t.Run("a failed payment cancels the transaction", func(t *testing.T) {
		id, amount := newCheckout("pro")
		f := prepareForm(id, amount, "1004")
		f.Set("error", "-5")
		f.Set("error_note", "Card blocked")
		// The signature covers `action`, not `error`, so the original signature still holds.
		res := callback("prepare", f)
		if res.Error != clickErrTransCanceled {
			t.Fatalf("error = %d, want %d", res.Error, clickErrTransCanceled)
		}
		if got := status(id); got != StatusCanceled {
			t.Errorf("status = %q, want canceled", got)
		}
	})

	t.Run("a paid transaction opens a subscription exactly once", func(t *testing.T) {
		id, amount := newCheckout("pro")

		res := callback("prepare", prepareForm(id, amount, "2001"))
		if res.Error != clickOK || res.MerchantPrepareID == nil {
			t.Fatalf("prepare failed: %+v", res)
		}
		prepareID := strconv.FormatInt(*res.MerchantPrepareID, 10)
		if got := status(id); got != StatusPrepared {
			t.Fatalf("status = %q, want prepared", got)
		}

		// Click retries prepare; the identifier it already has must not change.
		again := callback("prepare", prepareForm(id, amount, "2001"))
		if again.MerchantPrepareID == nil || *again.MerchantPrepareID != *res.MerchantPrepareID {
			t.Errorf("a retried prepare changed merchant_prepare_id: %+v then %+v", res, again)
		}

		done := callback("complete", completeForm(id, amount, "2001", prepareID))
		if done.Error != clickOK {
			t.Fatalf("complete failed: %+v", done)
		}
		if done.MerchantConfirmID == nil || *done.MerchantConfirmID != *res.MerchantPrepareID {
			t.Errorf("merchant_confirm_id = %v, want the prepare id back", done.MerchantConfirmID)
		}
		if got := status(id); got != StatusPaid {
			t.Fatalf("status = %q, want paid", got)
		}

		var subs int
		_ = pool.QueryRow(ctx, `
			SELECT count(*) FROM subscriptions s JOIN subscription_plans p ON p.id = s.plan_id
			WHERE s.user_id = $1 AND s.status = 'active' AND p.code = 'pro'`, learner.ID).Scan(&subs)
		if subs != 1 {
			t.Fatalf("active pro subscriptions = %d, want 1", subs)
		}

		var linked bool
		_ = pool.QueryRow(ctx, `SELECT subscription_id IS NOT NULL FROM payment_transactions WHERE id = $1`, id).Scan(&linked)
		if !linked {
			t.Error("the transaction must point at the subscription it opened")
		}

		// The retry Click sends when our first reply is lost must not buy a second month.
		retry := callback("complete", completeForm(id, amount, "2001", prepareID))
		if retry.Error != clickErrAlreadyPaid {
			t.Fatalf("a retried complete returned %d, want %d (already paid)", retry.Error, clickErrAlreadyPaid)
		}
		_ = pool.QueryRow(ctx, `
			SELECT count(*) FROM subscriptions s JOIN subscription_plans p ON p.id = s.plan_id
			WHERE s.user_id = $1 AND s.status = 'active' AND p.code = 'pro'`, learner.ID).Scan(&subs)
		if subs != 1 {
			t.Errorf("active pro subscriptions after the retry = %d, want 1", subs)
		}
	})

	t.Run("the learner sees their own payments", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/payments/transactions", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("status = %d body = %s", w.Code, w.Body.String())
		}
		var envelope struct {
			Data []Transaction `json:"data"`
		}
		_ = json.Unmarshal(w.Body.Bytes(), &envelope)
		if len(envelope.Data) == 0 {
			t.Fatal("no transactions returned")
		}
		var paid int
		for _, tr := range envelope.Data {
			if tr.Status == StatusPaid {
				paid++
			}
		}
		if paid != 1 {
			t.Errorf("paid transactions = %d, want 1", paid)
		}
	})
}
