package owner

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/samandar-hodiev/engora/apps/api/internal/audit"
	"github.com/samandar-hodiev/engora/apps/api/internal/authz"
	"github.com/samandar-hodiev/engora/apps/api/internal/users"
	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/httpx"
)

// Who else runs the platform.
//
// Only the owner reaches these routes, and the rules they enforce are the ones that stop a
// staff list from becoming a way around the owner:
//
//   - nobody can be made OWNER here. There is exactly one owner and it is set in
//     configuration, so a second one cannot be created from inside the console.
//   - the owner cannot be edited or removed through this list, including by themselves.
//   - removing access demotes the account to USER and revokes its sessions rather than
//     deleting the person, because their audit trail and anything they authored should
//     outlive their access.
//
// The first password is chosen by the owner and handed over out of band. That is a real
// trade-off — a password sent over chat is a password somebody else may read — so the
// account is flagged must_change_password and told to replace it.

const (
	ActionStaffAdded          = "staff.added"
	ActionStaffRoleChanged    = "staff.role_changed"
	ActionStaffAccessRevoked  = "staff.access_revoked"
	ActionStaffPasswordReset  = "staff.password_reset"
	minStaffPasswordRuneCount = 10
)

// staffRoles are the roles the owner may hand out. OWNER is absent by design.
var staffRoles = []authz.Role{authz.RoleAnalyst, authz.RoleSupport, authz.RoleContentManager, authz.RoleAdmin}

func isStaffRole(r authz.Role) bool {
	for _, allowed := range staffRoles {
		if r == allowed {
			return true
		}
	}
	return false
}

type StaffMember struct {
	ID                 uuid.UUID  `json:"id"`
	Email              string     `json:"email"`
	Role               authz.Role `json:"role"`
	Status             string     `json:"status"`
	MustChangePassword bool       `json:"must_change_password"`
	LastLoginAt        *time.Time `json:"last_login_at"`
	CreatedAt          time.Time  `json:"created_at"`
	CreatedByEmail     *string    `json:"created_by_email"`
	/** Sessions still open for this account, so revoking access is an informed decision. */
	ActiveSessions int `json:"active_sessions"`
}

type NewStaffInput struct {
	Email string `json:"email" binding:"required,email,max=254"`
	Role  string `json:"role" binding:"required,oneof=ANALYST SUPPORT CONTENT_MANAGER ADMIN"`
	// Password is chosen by the owner. The account is asked to replace it on first sign-in.
	Password string `json:"password" binding:"required,min=10,max=128"`
}

type ChangeRoleInput struct {
	Role string `json:"role" binding:"required,oneof=ANALYST SUPPORT CONTENT_MANAGER ADMIN"`
}

type ResetStaffPasswordInput struct {
	Password string `json:"password" binding:"required,min=10,max=128"`
}

// Hasher is the password hasher the auth service already uses. Staff passwords are hashed
// the same way learner passwords are; there is no second scheme.
type Hasher interface {
	Hash(password string) (string, error)
}

func (m *Module) registerStaffRoutes(v1 *gin.RouterGroup) {
	g := v1.Group("/admin/staff", authz.RequirePermission(authz.PermStaffManage))
	g.GET("", m.listStaff)
	g.GET("/roles", m.staffRoleOptions)
	g.POST("", m.addStaff)
	g.PATCH("/:id", m.changeStaffRole)
	g.POST("/:id/password", m.resetStaffPassword)
	g.DELETE("/:id", m.revokeStaffAccess)
}

func (m *Module) staffRoleOptions(c *gin.Context) {
	type option struct {
		Role        authz.Role         `json:"role"`
		Permissions []authz.Permission `json:"permissions"`
	}
	out := make([]option, 0, len(staffRoles))
	for _, r := range staffRoles {
		out = append(out, option{Role: r, Permissions: authz.PermissionsFor(r)})
	}
	httpx.OK(c, out)
}

func (m *Module) listStaff(c *gin.Context) {
	rows, err := m.pool.Query(c.Request.Context(), `
		SELECT u.id, u.email, u.role, u.status, u.must_change_password, u.last_login_at, u.created_at,
		       creator.email,
		       (SELECT count(*) FROM refresh_tokens t
		         WHERE t.user_id = u.id AND t.revoked_at IS NULL AND t.replaced_by IS NULL AND t.expires_at > now())
		FROM users u
		LEFT JOIN users creator ON creator.id = u.created_by
		WHERE u.role <> 'USER'
		ORDER BY (u.role = 'OWNER') DESC, u.created_at`)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	defer rows.Close()

	out := []StaffMember{}
	for rows.Next() {
		var s StaffMember
		if err := rows.Scan(&s.ID, &s.Email, &s.Role, &s.Status, &s.MustChangePassword, &s.LastLoginAt,
			&s.CreatedAt, &s.CreatedByEmail, &s.ActiveSessions); err != nil {
			httpx.Fail(c, err)
			return
		}
		out = append(out, s)
	}
	if err := rows.Err(); err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, out)
}

func (m *Module) addStaff(c *gin.Context) {
	var in NewStaffInput
	if err := httpx.BindJSON(c, &in); err != nil {
		httpx.Fail(c, err)
		return
	}
	actor, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	if m.hasher == nil || m.users == nil {
		httpx.Fail(c, apperr.NotImplemented("Staff management"))
		return
	}
	email := strings.ToLower(strings.TrimSpace(in.Email))
	if m.ownerEmail != "" && strings.EqualFold(email, m.ownerEmail) {
		httpx.Fail(c, apperr.Conflict("That address is the owner's. It already has access."))
		return
	}
	hash, err := m.hasher.Hash(in.Password)
	if err != nil {
		httpx.Fail(c, err)
		return
	}

	created, err := m.users.CreateAccount(c.Request.Context(), users.NewAccount{
		Email: email, PasswordHash: hash, Timezone: "UTC", EmailVerified: true, AuthProvider: "email",
		Role: authz.Role(in.Role), MustChangePassword: true, CreatedBy: &actor.UserID,
	})
	if errors.Is(err, users.ErrEmailTaken) {
		httpx.Fail(c, apperr.Conflict("An account already exists for that email. Change its role instead.").
			WithDetails(map[string]any{"reason": "email_taken"}))
		return
	}
	if err != nil {
		httpx.Fail(c, err)
		return
	}

	m.audit.Record(c.Request.Context(), audit.Entry{ActorID: &actor.UserID, Action: ActionStaffAdded,
		EntityType: "user", EntityID: created.ID.String(), IP: c.ClientIP(), UserAgent: c.Request.UserAgent(),
		Metadata: map[string]any{"email": email, "role": in.Role}})
	c.JSON(http.StatusCreated, gin.H{"success": true, "data": StaffMember{
		ID: created.ID, Email: created.Email, Role: created.Role, Status: string(created.Status),
		MustChangePassword: true, CreatedAt: created.CreatedAt,
	}})
}

// staffTarget resolves the :id and refuses the two accounts this list must not touch: the
// owner, and the person making the request.
func (m *Module) staffTarget(c *gin.Context) (uuid.UUID, authz.Role, uuid.UUID, bool) {
	actor, err := authz.CurrentPrincipal(c)
	if err != nil {
		httpx.Fail(c, err)
		return uuid.Nil, "", uuid.Nil, false
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		httpx.Fail(c, apperr.Validation(map[string]any{"reason": "invalid_id"}))
		return uuid.Nil, "", uuid.Nil, false
	}
	var role authz.Role
	if err := m.pool.QueryRow(c.Request.Context(), `SELECT role FROM users WHERE id = $1`, id).Scan(&role); err != nil {
		httpx.Fail(c, apperr.NotFound("That account no longer exists"))
		return uuid.Nil, "", uuid.Nil, false
	}
	if role == authz.RoleOwner || id == actor.UserID {
		httpx.Fail(c, apperr.Forbidden("The owner's own access cannot be changed here."))
		return uuid.Nil, "", uuid.Nil, false
	}
	return id, role, actor.UserID, true
}

func (m *Module) changeStaffRole(c *gin.Context) {
	var in ChangeRoleInput
	if err := httpx.BindJSON(c, &in); err != nil {
		httpx.Fail(c, err)
		return
	}
	id, previous, actorID, ok := m.staffTarget(c)
	if !ok {
		return
	}
	role := authz.Role(in.Role)
	if !isStaffRole(role) {
		httpx.Fail(c, apperr.Validation(map[string]any{"reason": "invalid_role"}))
		return
	}
	if _, err := m.pool.Exec(c.Request.Context(), `UPDATE users SET role = $2 WHERE id = $1`, id, string(role)); err != nil {
		httpx.Fail(c, err)
		return
	}
	m.audit.Record(c.Request.Context(), audit.Entry{ActorID: &actorID, Action: ActionStaffRoleChanged,
		EntityType: "user", EntityID: id.String(), IP: c.ClientIP(), UserAgent: c.Request.UserAgent(),
		Metadata: map[string]any{"from": string(previous), "to": in.Role}})
	c.Status(http.StatusNoContent)
}

func (m *Module) resetStaffPassword(c *gin.Context) {
	var in ResetStaffPasswordInput
	if err := httpx.BindJSON(c, &in); err != nil {
		httpx.Fail(c, err)
		return
	}
	id, _, actorID, ok := m.staffTarget(c)
	if !ok {
		return
	}
	if m.hasher == nil {
		httpx.Fail(c, apperr.NotImplemented("Staff management"))
		return
	}
	hash, err := m.hasher.Hash(in.Password)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	// The old sessions go with the old password. A password reset that leaves the previous
	// holder signed in has not reset anything.
	if _, err := m.pool.Exec(c.Request.Context(), `
		UPDATE users SET password_hash = $2, must_change_password = true WHERE id = $1`, id, hash); err != nil {
		httpx.Fail(c, err)
		return
	}
	if err := m.revokeSessionsFor(c, id); err != nil {
		httpx.Fail(c, err)
		return
	}
	m.audit.Record(c.Request.Context(), audit.Entry{ActorID: &actorID, Action: ActionStaffPasswordReset,
		EntityType: "user", EntityID: id.String(), IP: c.ClientIP(), UserAgent: c.Request.UserAgent()})
	c.Status(http.StatusNoContent)
}

func (m *Module) revokeStaffAccess(c *gin.Context) {
	id, previous, actorID, ok := m.staffTarget(c)
	if !ok {
		return
	}
	// Demoted, not deleted: what they did stays attributable, and if they come back their
	// history is still theirs.
	if _, err := m.pool.Exec(c.Request.Context(), `
		UPDATE users SET role = 'USER', must_change_password = false WHERE id = $1`, id); err != nil {
		httpx.Fail(c, err)
		return
	}
	if err := m.revokeSessionsFor(c, id); err != nil {
		httpx.Fail(c, err)
		return
	}
	m.audit.Record(c.Request.Context(), audit.Entry{ActorID: &actorID, Action: ActionStaffAccessRevoked,
		EntityType: "user", EntityID: id.String(), IP: c.ClientIP(), UserAgent: c.Request.UserAgent(),
		Metadata: map[string]any{"previous_role": string(previous)}})
	c.Status(http.StatusNoContent)
}

func (m *Module) revokeSessionsFor(c *gin.Context, userID uuid.UUID) error {
	_, err := m.pool.Exec(c.Request.Context(), `
		UPDATE refresh_tokens SET revoked_at = now()
		WHERE user_id = $1 AND revoked_at IS NULL`, userID)
	return err
}
