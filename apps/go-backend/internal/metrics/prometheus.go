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

	// paymentSignatureFailures is deliberately its own series rather than
	// just a log line: a non-zero rate here means either an attempted
	// forgery or a misconfigured secret, and both need an alert. A sudden
	// jump on the "webhook" stage is the signature that
	// RAZORPAY_WEBHOOK_SECRET does not match the dashboard.
	paymentSignatureFailures = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "payment_signature_failures_total",
		Help: "Rejected payment/webhook signature verifications, by stage.",
	}, []string{"stage"})

	paymentOutcomes = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "payment_outcomes_total",
		Help: "Terminal payment outcomes, by result.",
	}, []string{"result"})

	inventoryConflicts = promauto.NewCounter(prometheus.CounterOpts{
		Name: "inventory_reservation_conflicts_total",
		Help: "Checkout attempts rejected because stock ran out mid-flight.",
	})

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

// RecordPaymentSignatureFailure counts a rejected signature. Stage is
// "verify" (checkout callback) or "webhook".
func RecordPaymentSignatureFailure(stage string) {
	paymentSignatureFailures.WithLabelValues(stage).Inc()
}

// RecordPaymentOutcome counts a terminal payment result: paid, failed,
// refunded or disputed.
func RecordPaymentOutcome(result string) {
	paymentOutcomes.WithLabelValues(result).Inc()
}

// RecordInventoryConflict counts a checkout that lost a race for the last
// units of stock.
func RecordInventoryConflict() {
	inventoryConflicts.Inc()
}
