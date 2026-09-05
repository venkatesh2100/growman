// Package metrics registers the Prometheus collectors served at /metrics
// and the RecordRequest hook the Prometheus middleware calls per request.
package metrics

import (
	"net/http"
	"strconv"
	"sync"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

var (
	httpServerRequests = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "http_server_requests_seconds",
		Help:    "HTTP request duration in seconds for server requests.",
		Buckets: prometheus.DefBuckets,
	}, []string{"app", "uri", "method", "status"})

	httpRequestDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "http_request_duration_seconds",
		Help:    "HTTP request duration in seconds.",
		Buckets: prometheus.DefBuckets,
	}, []string{"path", "method", "service", "status"})

	httpRequestDurationMax = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Name: "http_request_duration_seconds_max",
		Help: "Maximum HTTP request duration in seconds per path.",
	}, []string{"path", "method", "service", "status"})

	maxMu   sync.Mutex
	maxSeen = make(map[string]float64)
)

// Handler exposes Prometheus metrics.
func Handler() http.Handler {
	return promhttp.Handler()
}

// RecordRequest records HTTP request metrics used by the API Performance dashboard.
func RecordRequest(app, uri, method string, status int, durationSeconds float64) {
	statusLabel := strconv.Itoa(status)

	httpServerRequests.WithLabelValues(app, uri, method, statusLabel).Observe(durationSeconds)
	httpRequestDuration.WithLabelValues(uri, method, app, statusLabel).Observe(durationSeconds)

	key := uri + "\x00" + method + "\x00" + app + "\x00" + statusLabel
	maxMu.Lock()
	defer maxMu.Unlock()
	if prev, ok := maxSeen[key]; !ok || durationSeconds > prev {
		maxSeen[key] = durationSeconds
		httpRequestDurationMax.WithLabelValues(uri, method, app, statusLabel).Set(durationSeconds)
	}
}
