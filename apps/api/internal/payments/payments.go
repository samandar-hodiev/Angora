// Package payments will integrate billing providers (Phase 9).
//
// Web checkout (e.g. Stripe) and in-app purchases (App Store, Google Play) all end in the
// same place: a row in subscriptions with provider + provider_subscription_id. Entitlement
// logic lives in internal/subscriptions and never depends on which provider billed.
package payments

import (
	"context"

	"github.com/google/uuid"
)

// Provider is implemented once per billing provider.
type Provider interface {
	Name() string
	// CreateCheckout starts a purchase of planCode and returns a URL (web) or a
	// provider-specific token (mobile) for the client.
	CreateCheckout(ctx context.Context, userID uuid.UUID, planCode string) (Checkout, error)
	// ParseWebhook verifies a provider callback and normalizes it into an event.
	ParseWebhook(ctx context.Context, payload []byte, signature string) (Event, error)
}

type Checkout struct {
	URL   string
	Token string
}

// Event is a provider-agnostic subscription change.
type Event struct {
	Type                   string // subscription.activated | renewed | canceled | expired | payment_failed
	UserID                 uuid.UUID
	PlanCode               string
	ProviderSubscriptionID string
}
