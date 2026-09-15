package httpx

import (
	"strings"

	"github.com/gin-gonic/gin"
)

// ClientPlatform reads the X-Client-Platform header (web | ios | android), defaulting to
// "unknown". It is informational only and never used for authorization.
func ClientPlatform(c *gin.Context) string {
	platform := strings.ToLower(c.GetHeader("X-Client-Platform"))
	switch platform {
	case "web", "ios", "android":
		return platform
	default:
		return "unknown"
	}
}
