package httpx

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"reflect"
	"strconv"
	"strings"
	"sync"

	"github.com/gin-gonic/gin"
	"github.com/gin-gonic/gin/binding"
	"github.com/go-playground/validator/v10"

	"github.com/samandar-hodiev/engora/apps/api/pkg/apperr"
)

var configureOnce sync.Once

// ConfigureValidator makes validation errors report JSON field names ("display_name")
// rather than Go field names ("DisplayName"), so clients can map errors to form fields.
func ConfigureValidator() {
	configureOnce.Do(func() {
		if v, ok := binding.Validator.Engine().(*validator.Validate); ok {
			v.RegisterTagNameFunc(func(f reflect.StructField) string {
				name := strings.SplitN(f.Tag.Get("json"), ",", 2)[0]
				if name == "-" || name == "" {
					return f.Name
				}
				return name
			})
		}
	})
}

// BindJSON decodes and validates a JSON body into dst. It returns a VALIDATION_ERROR with
// per-field details, or BAD_REQUEST for malformed JSON.
func BindJSON(c *gin.Context, dst any) error {
	ConfigureValidator()
	if err := c.ShouldBindJSON(dst); err != nil {
		return translateBindError(err)
	}
	return nil
}

// BindQuery decodes and validates query parameters into dst.
func BindQuery(c *gin.Context, dst any) error {
	ConfigureValidator()
	if err := c.ShouldBindQuery(dst); err != nil {
		return translateBindError(err)
	}
	return nil
}

func translateBindError(err error) error {
	var verrs validator.ValidationErrors
	if errors.As(err, &verrs) {
		fields := make(map[string]any, len(verrs))
		for _, fe := range verrs {
			fields[fieldPath(fe)] = describe(fe)
		}
		return apperr.Validation(map[string]any{"fields": fields})
	}

	var maxBytes *http.MaxBytesError
	if errors.As(err, &maxBytes) {
		return apperr.New(apperr.CodePayloadTooLarge, "Request body is too large")
	}

	var syntaxErr *json.SyntaxError
	var typeErr *json.UnmarshalTypeError
	switch {
	case errors.Is(err, io.EOF):
		return apperr.BadRequest("Request body is required")
	case errors.As(err, &syntaxErr):
		return apperr.BadRequest("Request body is not valid JSON")
	case errors.As(err, &typeErr):
		return apperr.Validation(map[string]any{
			"fields": map[string]any{typeErr.Field: "has the wrong type"},
		})
	}
	return apperr.BadRequest("Invalid request")
}

// fieldPath drops the top-level struct name: "RegisterRequest.email" -> "email".
func fieldPath(fe validator.FieldError) string {
	ns := fe.Namespace()
	if i := strings.Index(ns, "."); i >= 0 {
		return ns[i+1:]
	}
	return fe.Field()
}

func describe(fe validator.FieldError) string {
	switch fe.Tag() {
	case "required":
		return "is required"
	case "email":
		return "must be a valid email address"
	case "min":
		return "must be at least " + fe.Param() + lengthUnit(fe)
	case "max":
		return "must be at most " + fe.Param() + lengthUnit(fe)
	case "oneof":
		return "must be one of: " + fe.Param()
	case "uuid", "uuid4":
		return "must be a valid UUID"
	case "url":
		return "must be a valid URL"
	default:
		return "is invalid"
	}
}

func lengthUnit(fe validator.FieldError) string {
	switch fe.Kind() {
	case reflect.String:
		return " characters"
	case reflect.Slice, reflect.Array, reflect.Map:
		return " items"
	default:
		return ""
	}
}

// Pagination is the shared page/page_size query contract.
type Pagination struct {
	Page     int `form:"page" binding:"omitempty,min=1"`
	PageSize int `form:"page_size" binding:"omitempty,min=1,max=100"`
}

func (p Pagination) Normalize() Pagination {
	if p.Page == 0 {
		p.Page = 1
	}
	if p.PageSize == 0 {
		p.PageSize = 20
	}
	return p
}

func (p Pagination) Offset() int { return (p.Page - 1) * p.PageSize }

// ParamInt64 is a tiny helper for numeric path params.
func ParamInt64(c *gin.Context, name string) (int64, error) {
	v, err := strconv.ParseInt(c.Param(name), 10, 64)
	if err != nil {
		return 0, apperr.BadRequest(name + " must be a number")
	}
	return v, nil
}
