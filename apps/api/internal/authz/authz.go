// Package authz implements role-based access control.
//
// Handlers and middleware check permissions, never role names. Roles are bundles of
// permissions defined in one table below, so adding TEACHER, CONTENT_EDITOR, MODERATOR or
// BUSINESS_ADMIN later means: insert the role row (migration) and add one entry to
// rolePermissions. No handler changes.
package authz

import (
	"sort"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
	"github.com/samandar-hodiev/engora/apps/api/pkg/httpx"
)

type Role string

const (
	RoleUser  Role = "USER"
	RoleAdmin Role = "ADMIN"
	// Operator roles. They exist so the people who run the platform are not all given the
	// same key: an editor who publishes lessons has no reason to be able to change prices,
	// and support staff have no reason to be able to change either.
	RoleContentManager Role = "CONTENT_MANAGER"
	RoleSupport        Role = "SUPPORT"
	RoleAnalyst        Role = "ANALYST"
)

// Roles is every role this build knows, in ascending order of reach. The console lists them
// with their permissions so whoever grants access can see what it carries.
func Roles() []Role {
	return []Role{RoleUser, RoleAnalyst, RoleSupport, RoleContentManager, RoleAdmin}
}

// PermissionsFor returns the permissions a role grants, sorted, for display and for tests.
func PermissionsFor(r Role) []Permission {
	set := rolePermissions[r]
	out := make([]Permission, 0, len(set))
	for p := range set {
		out = append(out, p)
	}
	sort.Slice(out, func(i, j int) bool { return out[i] < out[j] })
	return out
}

type Permission string

const (
	PermProfileManageOwn    Permission = "profile:manage_own"
	PermLearningPractice    Permission = "learning:practice"
	PermContentRead         Permission = "content:read"
	PermContentManage       Permission = "content:manage"
	PermAssessmentsRead     Permission = "assessments:read"
	PermAssessmentsManage   Permission = "assessments:manage"
	PermUsersRead           Permission = "users:read"
	PermUsersManage         Permission = "users:manage"
	PermSubscriptionsManage Permission = "subscriptions:manage"
	PermAIUsageRead         Permission = "ai_usage:read"
	PermAuditRead           Permission = "audit:read"
	PermSettingsManage      Permission = "settings:manage"
	PermSystemRead          Permission = "system:read"
)

var learner = []Permission{
	PermProfileManageOwn,
	PermLearningPractice,
	PermContentRead,
}

var rolePermissions = map[Role]map[Permission]struct{}{
	RoleUser: setOf(learner...),

	// Reads the platform, changes nothing.
	RoleAnalyst: setOf(append(learner,
		PermUsersRead,
		PermAIUsageRead,
		PermAssessmentsRead,
		PermSystemRead,
	)...),

	// Answers learners: can look them up and suspend an abusive account, cannot touch
	// pricing, content or assessments.
	RoleSupport: setOf(append(learner,
		PermUsersRead,
		PermUsersManage,
		PermSystemRead,
	)...),

	// Owns what learners study. No access to billing or accounts.
	RoleContentManager: setOf(append(learner,
		PermContentRead,
		PermContentManage,
		PermAssessmentsRead,
		PermAssessmentsManage,
	)...),

	RoleAdmin: setOf(append(learner,
		PermContentManage,
		PermAssessmentsRead,
		PermAssessmentsManage,
		PermUsersRead,
		PermUsersManage,
		PermSubscriptionsManage,
		PermAIUsageRead,
		PermAuditRead,
		PermSettingsManage,
		PermSystemRead,
	)...),
}

func setOf(perms ...Permission) map[Permission]struct{} {
	s := make(map[Permission]struct{}, len(perms))
	for _, p := range perms {
		s[p] = struct{}{}
	}
	return s
}

// Valid reports whether the role is known to this build.
func (r Role) Valid() bool {
	_, ok := rolePermissions[r]
	return ok
}

// Can reports whether role r grants permission p. Unknown roles grant nothing.
func Can(r Role, p Permission) bool {
	_, ok := rolePermissions[r][p]
	return ok
}

// Principal is the authenticated caller.
type Principal struct {
	UserID    uuid.UUID
	Role      Role
	SessionID uuid.UUID
}

func (p Principal) Can(perm Permission) bool { return Can(p.Role, perm) }

const principalKey = "authz.principal"

// SetPrincipal is called by the authentication middleware.
func SetPrincipal(c *gin.Context, p Principal) {
	c.Set(principalKey, p)
	c.Set("user_id", p.UserID.String()) // for access logs
}

// PrincipalFrom returns the authenticated caller, if any.
func PrincipalFrom(c *gin.Context) (Principal, bool) {
	v, ok := c.Get(principalKey)
	if !ok {
		return Principal{}, false
	}
	p, ok := v.(Principal)
	return p, ok
}

// CurrentPrincipal returns the caller or an UNAUTHORIZED error.
func CurrentPrincipal(c *gin.Context) (Principal, error) {
	p, ok := PrincipalFrom(c)
	if !ok {
		return Principal{}, apperr.Unauthorized("Authentication required")
	}
	return p, nil
}

// RequireAuthenticated rejects anonymous requests.
func RequireAuthenticated() gin.HandlerFunc {
	return func(c *gin.Context) {
		if _, ok := PrincipalFrom(c); !ok {
			httpx.WriteError(c, apperr.Unauthorized("Authentication required"))
			return
		}
		c.Next()
	}
}

// RequirePermission rejects callers lacking any of the given permissions.
func RequirePermission(perms ...Permission) gin.HandlerFunc {
	return func(c *gin.Context) {
		p, ok := PrincipalFrom(c)
		if !ok {
			httpx.WriteError(c, apperr.Unauthorized("Authentication required"))
			return
		}
		for _, perm := range perms {
			if !p.Can(perm) {
				httpx.WriteError(c, apperr.Forbidden("You do not have permission to perform this action"))
				return
			}
		}
		c.Next()
	}
}
