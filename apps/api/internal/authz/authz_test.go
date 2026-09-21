package authz

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func TestRolePermissions(t *testing.T) {
	cases := []struct {
		role Role
		perm Permission
		want bool
	}{
		{RoleUser, PermLearningPractice, true},
		{RoleUser, PermProfileManageOwn, true},
		{RoleUser, PermContentManage, false},
		{RoleUser, PermUsersRead, false},
		{RoleAdmin, PermLearningPractice, true},
		{RoleAdmin, PermUsersManage, true},
		{Role("UNKNOWN"), PermContentRead, false},
	}
	for _, tc := range cases {
		if got := Can(tc.role, tc.perm); got != tc.want {
			t.Errorf("Can(%s, %s) = %v, want %v", tc.role, tc.perm, got, tc.want)
		}
	}
	if Role("TEACHER").Valid() {
		t.Error("roles must be explicitly defined before they are valid")
	}
}

func routerWith(principal *Principal) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) {
		if principal != nil {
			SetPrincipal(c, *principal)
		}
		c.Next()
	})
	r.GET("/admin", RequirePermission(PermUsersRead), func(c *gin.Context) { c.Status(http.StatusOK) })
	r.GET("/me", RequireAuthenticated(), func(c *gin.Context) { c.Status(http.StatusOK) })
	return r
}

func status(r http.Handler, path string) int {
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
	return w.Code
}

func TestRequirePermission(t *testing.T) {
	user := &Principal{UserID: uuid.New(), Role: RoleUser}
	admin := &Principal{UserID: uuid.New(), Role: RoleAdmin}

	if got := status(routerWith(nil), "/admin"); got != http.StatusUnauthorized {
		t.Errorf("anonymous: %d, want 401", got)
	}
	if got := status(routerWith(user), "/admin"); got != http.StatusForbidden {
		t.Errorf("user: %d, want 403", got)
	}
	if got := status(routerWith(admin), "/admin"); got != http.StatusOK {
		t.Errorf("admin: %d, want 200", got)
	}
}

func TestRequireAuthenticated(t *testing.T) {
	if got := status(routerWith(nil), "/me"); got != http.StatusUnauthorized {
		t.Errorf("anonymous: %d, want 401", got)
	}
	if got := status(routerWith(&Principal{UserID: uuid.New(), Role: RoleUser}), "/me"); got != http.StatusOK {
		t.Errorf("user: %d, want 200", got)
	}
}

// The point of splitting ADMIN into operator roles is that each one is missing something.
// These are the boundaries the product depends on, stated as tests so a future edit to the
// permission table cannot quietly widen a role.
func TestOperatorRoleBoundaries(t *testing.T) {
	cases := []struct {
		role  Role
		perm  Permission
		grant bool
		why   string
	}{
		{RoleContentManager, PermContentManage, true, "a content manager publishes lessons"},
		{RoleContentManager, PermAssessmentsManage, true, "a content manager owns the question bank"},
		{RoleContentManager, PermSubscriptionsManage, false, "an editor must not be able to change prices"},
		{RoleContentManager, PermUsersRead, false, "an editor has no reason to read learner records"},

		{RoleSupport, PermUsersRead, true, "support looks learners up"},
		{RoleSupport, PermUsersManage, true, "support can suspend an abusive account"},
		{RoleSupport, PermSubscriptionsManage, false, "support must not be able to change billing"},
		{RoleSupport, PermContentManage, false, "support does not edit lessons"},

		{RoleAnalyst, PermUsersRead, true, "an analyst reads the platform"},
		{RoleAnalyst, PermAIUsageRead, true, "an analyst reads AI cost"},
		{RoleAnalyst, PermUsersManage, false, "an analyst changes nothing about an account"},
		{RoleAnalyst, PermContentManage, false, "an analyst does not edit content"},
		{RoleAnalyst, PermAssessmentsManage, false, "an analyst does not edit questions"},

		{RoleUser, PermUsersRead, false, "a learner cannot read other learners"},
		{RoleUser, PermContentManage, false, "a learner cannot publish content"},
		{RoleUser, PermAuditRead, false, "a learner cannot read the audit log"},

		{RoleAdmin, PermSubscriptionsManage, true, "the owner role keeps full access"},
		{RoleAdmin, PermAuditRead, true, "the owner role keeps full access"},
	}

	for _, tc := range cases {
		if got := Can(tc.role, tc.perm); got != tc.grant {
			t.Errorf("Can(%s, %s) = %v, want %v — %s", tc.role, tc.perm, got, tc.grant, tc.why)
		}
	}
}

func TestRolesAreAllValidAndListed(t *testing.T) {
	for _, r := range Roles() {
		if !r.Valid() {
			t.Errorf("Roles() lists %s, which has no permission set", r)
		}
		if len(PermissionsFor(r)) == 0 {
			t.Errorf("%s grants nothing", r)
		}
	}
	if Can("MADE_UP_ROLE", PermContentRead) {
		t.Error("an unknown role must grant nothing")
	}
}
