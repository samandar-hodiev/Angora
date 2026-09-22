package owner

import (
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/httpx"
)

// Sessions and sign-ins.
//
// Both read the records authentication already keeps — refresh_tokens for what is signed
// in, audit_logs for what has signed in — rather than a second store invented for a
// settings page. There is no new authentication system here and no new state: revoking a
// session is the same revocation the auth service performs, so a session revoked from this
// page is revoked everywhere.

type Session struct {
	ID        uuid.UUID `json:"id"`
	Platform  string    `json:"platform"`
	UserAgent string    `json:"user_agent"`
	IP        string    `json:"ip_address"`
	/** The one making this request. It is offered last and cannot be revoked from here. */
	Current   bool      `json:"current"`
	ExpiresAt time.Time `json:"expires_at"`
	CreatedAt time.Time `json:"created_at"`
}

// sessions lists this operator's live sessions. A session is live when it has not been
// revoked, has not expired, and has not already been rotated into a newer one — that last
// condition is what stops a month of refreshes showing up as a month of devices.
func (m *Module) sessions(c *gin.Context) {
	p, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	rows, err := m.pool.Query(c.Request.Context(), `
		SELECT id, platform, user_agent, ip_address, family_id = $2, expires_at, created_at
		FROM refresh_tokens
		WHERE user_id = $1 AND revoked_at IS NULL AND replaced_by IS NULL AND expires_at > now()
		ORDER BY (family_id = $2) DESC, created_at DESC
		LIMIT 50`, p.UserID, p.SessionID)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	defer rows.Close()

	list := []Session{}
	for rows.Next() {
		var s Session
		if err := rows.Scan(&s.ID, &s.Platform, &s.UserAgent, &s.IP, &s.Current, &s.ExpiresAt, &s.CreatedAt); err != nil {
			httpx.Fail(c, err)
			return
		}
		list = append(list, s)
	}
	if err := rows.Err(); err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, list)
}

// revokeSession signs one other device out. The whole token family goes, not the one row:
// revoking a single refresh token would leave its successors usable, which is not what
// "sign this device out" means to anyone who presses it.
func (m *Module) revokeSession(c *gin.Context) {
	p, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		httpx.Fail(c, apperr.BadRequest("Invalid session id"))
		return
	}
	tag, err := m.pool.Exec(c.Request.Context(), `
		UPDATE refresh_tokens SET revoked_at = now()
		WHERE user_id = $1 AND revoked_at IS NULL
		  AND family_id = (SELECT family_id FROM refresh_tokens WHERE id = $2 AND user_id = $1)
		  AND family_id <> $3`, p.UserID, id, p.SessionID)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	if tag.RowsAffected() == 0 {
		// Either it is not theirs, or it is the session they are using right now.
		httpx.Fail(c, apperr.NotFound("Session"))
		return
	}
	m.sessions(c)
}

// revokeOtherSessions signs out everything except the device asking. Keeping the current
// one is deliberate: an operator who locks themselves out of the console mid-incident is
// worse off than one who has to press it twice.
func (m *Module) revokeOtherSessions(c *gin.Context) {
	p, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	if _, err := m.pool.Exec(c.Request.Context(), `
		UPDATE refresh_tokens SET revoked_at = now()
		WHERE user_id = $1 AND revoked_at IS NULL AND family_id <> $2`, p.UserID, p.SessionID); err != nil {
		httpx.Fail(c, err)
		return
	}
	m.sessions(c)
}

type SignIn struct {
	Action    string    `json:"action"`
	IP        string    `json:"ip_address"`
	UserAgent string    `json:"user_agent"`
	CreatedAt time.Time `json:"created_at"`
}

// signIns is the login history, read from the audit trail the auth service already writes.
// Failed attempts are included: a run of them is the thing worth seeing.
func (m *Module) signIns(c *gin.Context) {
	p, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	rows, err := m.pool.Query(c.Request.Context(), `
		SELECT action, ip_address, user_agent, created_at
		FROM audit_logs
		WHERE actor_id = $1 AND action IN ('auth.logged_in', 'auth.login_failed', 'auth.logged_out')
		ORDER BY created_at DESC LIMIT 20`, p.UserID)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	defer rows.Close()

	list := []SignIn{}
	for rows.Next() {
		var s SignIn
		if err := rows.Scan(&s.Action, &s.IP, &s.UserAgent, &s.CreatedAt); err != nil {
			httpx.Fail(c, err)
			return
		}
		list = append(list, s)
	}
	if err := rows.Err(); err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, list)
}
