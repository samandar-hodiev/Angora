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
