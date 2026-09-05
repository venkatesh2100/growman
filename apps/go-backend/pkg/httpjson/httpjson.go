// Package httpjson provides small, dependency-free helpers for writing and
// reading JSON HTTP bodies with a consistent error shape ({"error": "..."}).
package httpjson

import (
	"encoding/json"
	"net/http"
	"strconv"
)

// JSON writes a JSON response with status code.
func JSON(w http.ResponseWriter, status int, payload any) {
	b, err := json.Marshal(payload)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":"encode failed"}`))
		return
	}
	Raw(w, status, b)
}

// Raw writes pre-encoded JSON.
func Raw(w http.ResponseWriter, status int, body []byte) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Content-Length", strconv.Itoa(len(body)))
	w.WriteHeader(status)
	_, _ = w.Write(body)
}

// Error writes an error message with status code.
func Error(w http.ResponseWriter, status int, msg string) {
	JSON(w, status, map[string]string{"error": msg})
}

// Decode JSON-decodes the request body into v. On failure it writes a 400
// response (badMsg defaults to "invalid request body") and returns false;
// callers should return immediately when it does:
//
//	var req X
//	if !httpjson.Decode(w, r, &req) {
//		return
//	}
func Decode(w http.ResponseWriter, r *http.Request, v any, badMsg ...string) bool {
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		msg := "invalid request body"
		if len(badMsg) > 0 {
			msg = badMsg[0]
		}
		Error(w, http.StatusBadRequest, msg)
		return false
	}
	return true
}
