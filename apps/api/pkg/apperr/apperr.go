// Package apperr defines the typed errors that cross layer boundaries.
//
// Services return *apperr.Error for anything a client should know about. Everything else
// (driver errors, provider failures, bugs) is treated as INTERNAL_ERROR by the HTTP layer
// and never reaches the client verbatim.
package apperr

import (
	"errors"
	"net/http"
)

// Code is a stable, machine-readable error identifier. Clients (web, iOS, Android)
// branch on codes, never on messages, so codes must not be renamed once shipped.
type Code string

const (
	CodeValidation          Code = "VALIDATION_ERROR"
	CodeBadRequest          Code = "BAD_REQUEST"
	CodeUnauthorized        Code = "UNAUTHORIZED"
	CodeForbidden           Code = "FORBIDDEN"
	CodeEntitlementRequired Code = "ENTITLEMENT_REQUIRED"
	CodeUsageLimitReached   Code = "USAGE_LIMIT_REACHED"
	CodeNotFound            Code = "NOT_FOUND"
	CodeConflict            Code = "CONFLICT"
	CodePayloadTooLarge     Code = "PAYLOAD_TOO_LARGE"
	CodeUnsupportedMedia    Code = "UNSUPPORTED_MEDIA_TYPE"
	CodeRateLimited         Code = "RATE_LIMITED"
	CodeNotImplemented      Code = "NOT_IMPLEMENTED"
	CodeUnavailable         Code = "SERVICE_UNAVAILABLE"
	CodeInternal            Code = "INTERNAL_ERROR"
)

var statusByCode = map[Code]int{
	CodeValidation:          http.StatusUnprocessableEntity,
	CodeBadRequest:          http.StatusBadRequest,
	CodeUnauthorized:        http.StatusUnauthorized,
	CodeForbidden:           http.StatusForbidden,
	CodeEntitlementRequired: http.StatusForbidden,
	CodeUsageLimitReached:   http.StatusTooManyRequests,
	CodeNotFound:            http.StatusNotFound,
	CodeConflict:            http.StatusConflict,
	CodePayloadTooLarge:     http.StatusRequestEntityTooLarge,
	CodeUnsupportedMedia:    http.StatusUnsupportedMediaType,
	CodeRateLimited:         http.StatusTooManyRequests,
	CodeNotImplemented:      http.StatusNotImplemented,
	CodeUnavailable:         http.StatusServiceUnavailable,
	CodeInternal:            http.StatusInternalServerError,
}

// Error is a client-safe error. Message and Details are shown to the client; Err is the
// internal cause and is only ever logged.
type Error struct {
	Code    Code
	Message string
	Details map[string]any
	Err     error
}

func (e *Error) Error() string {
	if e.Err != nil {
		return string(e.Code) + ": " + e.Message + ": " + e.Err.Error()
	}
	return string(e.Code) + ": " + e.Message
}

func (e *Error) Unwrap() error { return e.Err }

// Status is the HTTP status that corresponds to the error code.
func (e *Error) Status() int {
	if s, ok := statusByCode[e.Code]; ok {
		return s
	}
	return http.StatusInternalServerError
}

// WithDetails returns a copy of the error carrying structured details.
func (e *Error) WithDetails(details map[string]any) *Error {
	cp := *e
	cp.Details = details
	return &cp
}

func New(code Code, message string) *Error {
	return &Error{Code: code, Message: message}
}

// Wrap attaches an internal cause that is logged but never exposed.
func Wrap(err error, code Code, message string) *Error {
	return &Error{Code: code, Message: message, Err: err}
}

func Validation(details map[string]any) *Error {
	return &Error{Code: CodeValidation, Message: "Invalid request", Details: details}
}

func BadRequest(message string) *Error   { return New(CodeBadRequest, message) }
func Unauthorized(message string) *Error { return New(CodeUnauthorized, message) }
func Forbidden(message string) *Error    { return New(CodeForbidden, message) }
func NotFound(resource string) *Error    { return New(CodeNotFound, resource+" not found") }
func Conflict(message string) *Error     { return New(CodeConflict, message) }
func NotImplemented(feature string) *Error {
	return New(CodeNotImplemented, feature+" is not available yet")
}

func Internal(err error) *Error {
	return &Error{Code: CodeInternal, Message: "Something went wrong", Err: err}
}

// From converts any error into a client-safe *Error. Unknown errors become
// INTERNAL_ERROR with a generic message so internals never leak.
func From(err error) *Error {
	var appErr *Error
	if errors.As(err, &appErr) {
		return appErr
	}
	return Internal(err)
}

// Is reports whether err is an *Error with the given code.
func Is(err error, code Code) bool {
	var appErr *Error
	return errors.As(err, &appErr) && appErr.Code == code
}
