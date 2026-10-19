package handlers

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	appauth "github.com/venkatesh2100/growman/apps/go-backend/internal/auth"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/models"
	"github.com/venkatesh2100/growman/apps/go-backend/internal/services"
	"github.com/venkatesh2100/growman/apps/go-backend/pkg/httpjson"
	"gorm.io/gorm"
)

// Inventory model
//
// Stock lives on products.stock, or on product_sizes.stock for products
// that have sizes. A product with TrackInventory=false is always
// available (made-to-order or effectively unlimited items like seeds).
//
// The lifecycle is reserve -> commit or release:
//
//   - reserveOrderInventory runs when the order is created, before the
//     customer is sent to Razorpay. It is a conditional UPDATE, so the
//     oversell check and the decrement are a single atomic statement and
//     two simultaneous buyers of the last plant cannot both succeed.
//   - commitOrderInventory runs on the paid transition. Usually the units
//     are still deducted and it just records the reservation as permanent;
//     if the sweep already returned them (a payment that landed late), it
//     takes them again rather than letting the order oversell.
//   - releaseOrderInventory returns the units when the order fails, is
//     cancelled, or is swept as abandoned. orders.inventory_released
//     guards it so units are never returned twice.
//
// Holding stock from order creation (rather than from payment) is the
// right trade for a nursery: the window is minutes, and a customer who
// reaches the payment screen should not lose the item to someone browsing.

// abandonedOrderTTL is how long an unpaid order holds its reservation
// before the sweep returns the stock. Razorpay checkout sessions are good
// for ~15 minutes; this leaves room for a slow bank redirect.
const abandonedOrderTTL = 30 * time.Minute

// abandonedEmailWindow bounds who gets a nudge. Stock is returned for every
// unpaid order past the TTL, including a backlog from before the sweeper
// existed, but only a checkout that has just expired is worth an email.
// The window is the TTL plus a little slack for a missed tick.
const abandonedEmailWindow = 45 * time.Minute

// maxAbandonedEmailsPerSweep stops one pass from mailing the whole table
// if a bug or a traffic spike marks a crowd abandoned together. Each
// address is mailed at most once per pass; the rest are released silently.
const maxAbandonedEmailsPerSweep = 8

// stockLine is one resolved line of a cart with its availability.
type stockLine struct {
	ProductID     uint
	ProductSizeID *uint
	Name          string
	Quantity      int
	Available     int
	Tracked       bool
}

// loadStockLines resolves the stock position for each requested line.
func (h *Handler) loadStockLines(ctx context.Context, db *gorm.DB, items []OrderItemRequest) ([]stockLine, error) {
	productIDs := make([]uint, 0, len(items))
	sizeIDs := make([]uint, 0, len(items))
	for _, item := range items {
		productIDs = append(productIDs, item.ProductID)
		if item.ProductSizeID != nil {
			sizeIDs = append(sizeIDs, *item.ProductSizeID)
		}
	}

	var products []models.Product
	if err := db.WithContext(ctx).
		Select("id, name, stock, track_inventory").
		Where("id IN ?", productIDs).Find(&products).Error; err != nil {
		return nil, err
	}
	productByID := make(map[uint]models.Product, len(products))
	for _, p := range products {
		productByID[p.ID] = p
	}

	sizeByID := make(map[uint]models.ProductSize, len(sizeIDs))
	if len(sizeIDs) > 0 {
		var sizes []models.ProductSize
		if err := db.WithContext(ctx).
			Select("id, product_id, label, stock").
			Where("id IN ?", sizeIDs).Find(&sizes).Error; err != nil {
			return nil, err
		}
		for _, s := range sizes {
			sizeByID[s.ID] = s
		}
	}

	lines := make([]stockLine, 0, len(items))
	for _, item := range items {
		product, ok := productByID[item.ProductID]
		if !ok {
			return nil, fmt.Errorf("product %d not found", item.ProductID)
		}
		line := stockLine{
			ProductID:     item.ProductID,
			ProductSizeID: item.ProductSizeID,
			Name:          product.Name,
			Quantity:      item.Quantity,
			Tracked:       product.TrackInventory,
		}
		if item.ProductSizeID != nil {
			size, ok := sizeByID[*item.ProductSizeID]
			if !ok {
				return nil, fmt.Errorf("product size %d not found", *item.ProductSizeID)
			}
			line.Available = size.Stock
			if size.Label != "" {
				line.Name = product.Name + " (" + size.Label + ")"
			}
		} else {
			line.Available = product.Stock
		}
		lines = append(lines, line)
	}
	return lines, nil
}

// checkStockAvailability validates that every line can be fulfilled, and
// writes a structured 409 naming the offending lines when it cannot. The
// response shape mirrors the existing channel_unavailable/amount_mismatch
// conflicts the checkout page already knows how to render.
func (h *Handler) checkStockAvailability(w http.ResponseWriter, r *http.Request, items []OrderItemRequest) bool {
	lines, err := h.loadStockLines(r.Context(), h.DB, items)
	if err != nil {
		log.Printf("[INVENTORY] load stock: %v", err)
		httpjson.Error(w, http.StatusBadRequest, "failed to check availability")
		return false
	}

	type unavailable struct {
		ProductID     uint   `json:"productId"`
		ProductSizeID *uint  `json:"productSizeId,omitempty"`
		Name          string `json:"name"`
		Requested     int    `json:"requested"`
		Available     int    `json:"available"`
	}
	var problems []unavailable
	for _, line := range lines {
		if !line.Tracked {
			continue
		}
		if line.Available < line.Quantity {
			problems = append(problems, unavailable{
				ProductID:     line.ProductID,
				ProductSizeID: line.ProductSizeID,
				Name:          line.Name,
				Requested:     line.Quantity,
				Available:     max(line.Available, 0),
			})
		}
	}
	if len(problems) > 0 {
		httpjson.JSON(w, http.StatusConflict, map[string]any{
			"error": "out_of_stock",
			"items": problems,
		})
		return false
	}
	return true
}

// reserveOrderInventory deducts stock for an order's lines inside tx.
//
// Each line is a conditional UPDATE: the WHERE clause carries the
// availability check, so the database decides the winner when two buyers
// race for the last unit. Zero rows affected means someone else got there
// first, and the whole transaction is rolled back by the caller.
func (h *Handler) reserveOrderInventory(tx *gorm.DB, items []models.OrderItem) error {
	for _, item := range items {
		if item.Quantity < 1 {
			return fmt.Errorf("invalid quantity for product %d", item.ProductID)
		}

		var res *gorm.DB
		if item.ProductSize != nil {
			res = tx.Exec(`
				UPDATE product_sizes SET stock = stock - ?, updated_at = NOW()
				WHERE id = ? AND stock >= ?`,
				item.Quantity, *item.ProductSize, item.Quantity)
		} else {
			// Untracked products are always available, so skip them rather
			// than driving their stock negative.
			res = tx.Exec(`
				UPDATE products SET stock = stock - ?, updated_at = NOW()
				WHERE id = ? AND (track_inventory = false OR stock >= ?)`,
				item.Quantity, item.ProductID, item.Quantity)
		}
		if res.Error != nil {
			return fmt.Errorf("reserve product %d: %w", item.ProductID, res.Error)
		}
		if res.RowsAffected == 0 {
			return errOutOfStock{Name: item.Name, ProductID: item.ProductID}
		}
	}
	return nil
}

// errOutOfStock signals that a reservation lost the race for the last
// units, so the caller can answer 409 rather than 500.
type errOutOfStock struct {
	Name      string
	ProductID uint
}

func (e errOutOfStock) Error() string {
	if e.Name != "" {
		return fmt.Sprintf("%s is no longer available in the requested quantity", e.Name)
	}
	return fmt.Sprintf("product %d is no longer available in the requested quantity", e.ProductID)
}

// commitOrderInventory makes a reservation permanent.
//
// In the common case the units are still deducted from order creation and
// this only has to stop the abandoned-order sweep from clawing them back.
// The case that needs care is a payment that lands *after* the sweep
// already returned the stock — a slow bank redirect, or a customer who
// finished paying on a tab they left open. Clearing the flag alone would
// mark the order paid against units now sitting back on the shelf, which
// is an oversell we would only discover at packing time. So when the
// reservation was released, it is taken again.
//
// Returns errOutOfStock if the units can no longer be had. The caller
// decides what to do with a paid order we cannot fulfil; it must not
// silently succeed.
func (h *Handler) commitOrderInventory(tx *gorm.DB, order *models.Order) error {
	res := tx.Model(&models.Order{}).
		Where("id = ? AND inventory_released = false", order.ID).
		UpdateColumn("inventory_released", false)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 1 {
		// The reservation was still held; nothing to re-take.
		return nil
	}

	// The sweep (or a failure event) already returned these units.
	if err := h.reserveOrderInventory(tx, order.Items); err != nil {
		return err
	}
	return tx.Model(&models.Order{}).
		Where("id = ?", order.ID).
		UpdateColumn("inventory_released", false).Error
}

// releaseOrderInventory returns reserved units to stock. Guarded by
// orders.inventory_released so a replayed failure event (or a sweep racing
// a webhook) cannot credit the same units twice.
func (h *Handler) releaseOrderInventory(tx *gorm.DB, order *models.Order) error {
	// Claim the release first; if another caller already did, stop.
	res := tx.Model(&models.Order{}).
		Where("id = ? AND inventory_released = false", order.ID).
		UpdateColumn("inventory_released", true)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return nil
	}

	items := order.Items
	if len(items) == 0 {
		if err := tx.Where("order_id = ?", order.ID).Find(&items).Error; err != nil {
			return err
		}
	}
	for _, item := range items {
		if item.ProductSize != nil {
			if err := tx.Exec(`UPDATE product_sizes SET stock = stock + ?, updated_at = NOW() WHERE id = ?`,
				item.Quantity, *item.ProductSize).Error; err != nil {
				return err
			}
			continue
		}
		if err := tx.Exec(`UPDATE products SET stock = stock + ?, updated_at = NOW() WHERE id = ? AND track_inventory = true`,
			item.Quantity, item.ProductID).Error; err != nil {
			return err
		}
	}
	order.InventoryReleased = true
	return nil
}

// abandonedCandidate is one order the sweep has claimed.
type abandonedCandidate struct {
	ID            uint      `gorm:"column:id"`
	CustomerEmail string    `gorm:"column:customer_email"`
	CustomerName  string    `gorm:"column:customer_name"`
	CreatedAt     time.Time `gorm:"column:created_at"`
}

// restockTarget is a product (or one of its sizes) whose stock just
// crossed from empty to available.
type restockTarget struct {
	ProductID uint
	SizeID    *uint
}

// SweepAbandonedOrders returns stock held by orders that were created but
// never paid. Intended to be called on a ticker from main; safe to run
// concurrently with webhooks because the claim is a single conditional
// UPDATE (FOR UPDATE SKIP LOCKED) and stock is credited in the same
// transaction, only for rows that update actually won.
//
// The claim, the stock return, and the abandoned status are a handful of
// statements for the whole batch. Doing them per order was a round trip
// each, and against a remote Postgres that is a second per statement.
func (h *Handler) SweepAbandonedOrders(ctx context.Context) (released int, err error) {
	cutoff := time.Now().Add(-abandonedOrderTTL)

	var claimed []abandonedCandidate
	var restocks []restockTarget
	err = h.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// payment_status stays 'created' so a delayed bank redirect can
		// still complete. The status change and the release flag move
		// together, and only while the order is still unpaid, so a payment
		// that landed between ticks is left alone.
		if err := tx.Raw(`
			WITH due AS (
				SELECT id FROM orders
				WHERE payment_status = 'created'
				  AND inventory_released = false
				  AND created_at < ?
				  AND deleted_at IS NULL
				ORDER BY created_at
				LIMIT 200
				FOR UPDATE SKIP LOCKED
			)
			UPDATE orders AS o
			SET inventory_released = true,
			    status = 'abandoned',
			    updated_at = NOW()
			FROM due
			WHERE o.id = due.id
			  AND o.payment_status = 'created'
			  AND o.inventory_released = false
			  AND o.deleted_at IS NULL
			RETURNING o.id, o.customer_email, o.customer_name, o.created_at
		`, cutoff).Scan(&claimed).Error; err != nil {
			return err
		}
		if len(claimed) == 0 {
			return nil
		}

		ids := make([]uint, len(claimed))
		for i, order := range claimed {
			ids[i] = order.ID
		}
		var lines []struct {
			ProductID   uint  `gorm:"column:product_id"`
			ProductSize *uint `gorm:"column:product_size"`
			Quantity    int   `gorm:"column:quantity"`
		}
		if err := tx.Model(&models.OrderItem{}).
			Select("product_id, product_size, SUM(quantity)::int AS quantity").
			Where("order_id IN ?", ids).
			Group("product_id, product_size").
			Scan(&lines).Error; err != nil {
			return err
		}

		var sizeIDs, productIDs []uint
		var sizeQty, productQty []int
		for _, line := range lines {
			if line.Quantity < 1 {
				continue
			}
			if line.ProductSize != nil {
				sizeIDs = append(sizeIDs, *line.ProductSize)
				sizeQty = append(sizeQty, line.Quantity)
				continue
			}
			productIDs = append(productIDs, line.ProductID)
			productQty = append(productQty, line.Quantity)
		}
		fromSizes, err := applyStockDelta(tx, true, sizeIDs, sizeQty)
		if err != nil {
			return err
		}
		fromProducts, err := applyStockDelta(tx, false, productIDs, productQty)
		if err != nil {
			return err
		}
		restocks = append(fromSizes, fromProducts...)
		return nil
	})
	if err != nil {
		return 0, err
	}
	if len(claimed) == 0 {
		return 0, nil
	}

	nudges := selectAbandonedNudges(claimed, time.Now(), maxAbandonedEmailsPerSweep)
	h.sendAbandonedCartEmails(ctx, nudges)
	h.notifyAbandonedCheckouts(ctx, claimed)
	log.Printf("[INVENTORY] released stock for %d abandoned order(s), emailed %d", len(claimed), len(nudges))
	h.notifyBackInStock(ctx, restocks)
	return len(claimed), nil
}

// applyStockDelta adds qty to each id in one UPDATE and reports the rows
// whose stock crossed from empty to available. sizes selects product_sizes;
// otherwise the products table, and untracked products are left alone.
func applyStockDelta(tx *gorm.DB, sizes bool, ids []uint, qty []int) ([]restockTarget, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	if len(ids) != len(qty) {
		return nil, fmt.Errorf("stock delta length mismatch")
	}

	var b strings.Builder
	args := make([]any, 0, len(ids)*2)
	if sizes {
		b.WriteString(`UPDATE product_sizes AS s SET stock = s.stock + v.qty, updated_at = NOW() FROM (VALUES `)
	} else {
		b.WriteString(`UPDATE products AS s SET stock = s.stock + v.qty, updated_at = NOW() FROM (VALUES `)
	}
	for i := range ids {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteString("(?::bigint,?::int)")
		args = append(args, ids[i], qty[i])
	}
	b.WriteString(`) AS v(id, qty) WHERE s.id = v.id`)
	if !sizes {
		b.WriteString(` AND s.track_inventory = true`)
	}
	// RETURNING sees the post-update stock, so previous = new - qty.
	if sizes {
		b.WriteString(` RETURNING s.id, s.product_id, (s.stock - v.qty) AS prev_stock, s.stock AS new_stock`)
	} else {
		b.WriteString(` RETURNING s.id, s.id AS product_id, (s.stock - v.qty) AS prev_stock, s.stock AS new_stock`)
	}

	var rows []struct {
		ID        uint `gorm:"column:id"`
		ProductID uint `gorm:"column:product_id"`
		PrevStock int  `gorm:"column:prev_stock"`
		NewStock  int  `gorm:"column:new_stock"`
	}
	if err := tx.Raw(b.String(), args...).Scan(&rows).Error; err != nil {
		return nil, err
	}

	var targets []restockTarget
	for _, row := range rows {
		if row.PrevStock > 0 || row.NewStock < 1 {
			continue
		}
		target := restockTarget{ProductID: row.ProductID}
		if sizes {
			id := row.ID
			target.SizeID = &id
		}
		targets = append(targets, target)
	}
	return targets, nil
}

// selectAbandonedNudges picks who should hear about a released checkout.
// One address per pass, newest order wins, and anything older than
// abandonedEmailWindow is skipped so a backlog is not a mail merge.
func selectAbandonedNudges(orders []abandonedCandidate, now time.Time, limit int) []abandonedCandidate {
	if limit <= 0 || len(orders) == 0 {
		return nil
	}
	earliest := now.Add(-abandonedEmailWindow)
	sorted := append([]abandonedCandidate(nil), orders...)
	sort.Slice(sorted, func(i, j int) bool {
		return sorted[i].CreatedAt.After(sorted[j].CreatedAt)
	})

	seen := make(map[string]struct{}, len(sorted))
	out := make([]abandonedCandidate, 0, limit)
	for _, order := range sorted {
		if order.CreatedAt.Before(earliest) {
			continue
		}
		email := strings.ToLower(strings.TrimSpace(order.CustomerEmail))
		if !strings.Contains(email, "@") {
			continue
		}
		if _, ok := seen[email]; ok {
			continue
		}
		seen[email] = struct{}{}
		order.CustomerEmail = email
		out = append(out, order)
		if len(out) >= limit {
			break
		}
	}
	return out
}

// selectAbandonedAlerts picks checkouts to post to ops. Unlike the customer
// nudge, a checkout with no email is still reported. One address per pass,
// newest order wins, and anything older than the nudge window is skipped.
func selectAbandonedAlerts(orders []abandonedCandidate, now time.Time, limit int) []abandonedCandidate {
	if limit <= 0 || len(orders) == 0 {
		return nil
	}
	earliest := now.Add(-abandonedEmailWindow)
	sorted := append([]abandonedCandidate(nil), orders...)
	sort.Slice(sorted, func(i, j int) bool {
		return sorted[i].CreatedAt.After(sorted[j].CreatedAt)
	})

	seen := make(map[string]struct{}, len(sorted))
	out := make([]abandonedCandidate, 0, limit)
	for _, order := range sorted {
		if order.CreatedAt.Before(earliest) {
			continue
		}
		key := strings.ToLower(strings.TrimSpace(order.CustomerEmail))
		if !strings.Contains(key, "@") {
			key = fmt.Sprintf("#%d", order.ID)
		}
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		if strings.Contains(key, "@") {
			order.CustomerEmail = key
		}
		out = append(out, order)
		if len(out) >= limit {
			break
		}
	}
	return out
}

// sendAbandonedCartEmails delivers nudges one after another on a single
// goroutine. A burst of concurrent SMTP dials is what turns a sweep into
// a dozen mails landing in the same minute.
func (h *Handler) sendAbandonedCartEmails(ctx context.Context, nudges []abandonedCandidate) {
	if len(nudges) == 0 {
		return
	}
	ids := make([]uint, len(nudges))
	for i, nudge := range nudges {
		ids[i] = nudge.ID
	}
	var items []models.OrderItem
	if err := h.DB.WithContext(ctx).Where("order_id IN ?", ids).Find(&items).Error; err != nil {
		log.Printf("[INVENTORY] load abandoned items: %v", err)
		return
	}
	byOrder := make(map[uint][]models.OrderItem, len(nudges))
	for _, item := range items {
		byOrder[item.OrderID] = append(byOrder[item.OrderID], item)
	}

	orders := make([]models.Order, 0, len(nudges))
	for _, nudge := range nudges {
		lines := byOrder[nudge.ID]
		if len(lines) == 0 {
			continue
		}
		orders = append(orders, models.Order{
			Base:          models.Base{ID: nudge.ID},
			CustomerEmail: nudge.CustomerEmail,
			CustomerName:  nudge.CustomerName,
			Items:         lines,
		})
	}
	if len(orders) == 0 {
		return
	}
	go func() {
		for _, order := range orders {
			if err := h.deliverAbandonedCartEmail(order); err != nil {
				log.Printf("[EMAIL] abandoned cart for order %d: %v", order.ID, err)
			}
		}
	}()
}

// StartInventorySweeper runs SweepAbandonedOrders on a ticker until ctx is
// cancelled.
func (h *Handler) StartInventorySweeper(ctx context.Context, every time.Duration) {
	if every <= 0 {
		every = 5 * time.Minute
	}
	ticker := time.NewTicker(every)
	go func() {
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if _, err := h.SweepAbandonedOrders(ctx); err != nil {
					log.Printf("[INVENTORY] sweep: %v", err)
				}
			}
		}
	}()
}

// CreateBackInStockRequest subscribes an email to a restock notification.
// Doubles as a demand signal for what to propagate next.
func (h *Handler) CreateBackInStockRequest(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ProductID     uint   `json:"productId"`
		ProductSizeID *uint  `json:"productSizeId,omitempty"`
		Email         string `json:"email"`
	}
	if !httpjson.Decode(w, r, &req) {
		return
	}
	if req.ProductID == 0 {
		httpjson.Error(w, http.StatusBadRequest, "productId is required")
		return
	}
	if !services.ValidateEmail(req.Email) {
		httpjson.Error(w, http.StatusBadRequest, "invalid email format")
		return
	}

	var product models.Product
	if err := h.DB.WithContext(r.Context()).Select("id").First(&product, req.ProductID).Error; err != nil {
		httpjson.Error(w, http.StatusNotFound, "product not found")
		return
	}

	entry := models.BackInStockRequest{
		ProductID:     req.ProductID,
		ProductSizeID: req.ProductSizeID,
		Email:         req.Email,
	}
	if claims, ok := appauth.FromContext(r.Context()); ok {
		entry.UserID = &claims.UserID
	}
	// A repeat sign-up is not an error — just keep the existing row.
	if err := h.DB.WithContext(r.Context()).
		Where("product_id = ? AND email = ? AND notified_at IS NULL", req.ProductID, req.Email).
		FirstOrCreate(&entry).Error; err != nil {
		log.Printf("[INVENTORY] back-in-stock signup: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "failed to save request")
		return
	}

	httpjson.JSON(w, http.StatusOK, map[string]any{
		"success": true,
		"message": "We'll email you when this is back in stock.",
	})
}

// notifyBackInStock emails anyone waiting on an item that just came back.
// targets is the set whose stock crossed from empty to available; a sweep
// that only returned units onto a shelf that was never empty does not
// mail the waiting list. Best-effort: a send failure leaves notified_at
// unset so a later restock retries rather than silently dropping it.
func (h *Handler) notifyBackInStock(ctx context.Context, targets []restockTarget) {
	if len(targets) == 0 {
		return
	}
	seen := make(map[string]restockTarget, len(targets))
	for _, target := range targets {
		key := fmt.Sprintf("p:%d", target.ProductID)
		if target.SizeID != nil {
			key = fmt.Sprintf("s:%d", *target.SizeID)
		}
		seen[key] = target
	}
	parts := make([]string, 0, len(seen))
	args := make([]any, 0, len(seen)*2)
	for _, target := range seen {
		if target.SizeID != nil {
			parts = append(parts, "(product_id = ? AND (product_size_id IS NULL OR product_size_id = ?))")
			args = append(args, target.ProductID, *target.SizeID)
		} else {
			parts = append(parts, "(product_id = ? AND product_size_id IS NULL)")
			args = append(args, target.ProductID)
		}
	}
	var pending []models.BackInStockRequest
	if err := h.DB.WithContext(ctx).
		Where("notified_at IS NULL").
		Where(strings.Join(parts, " OR "), args...).
		Limit(100).
		Find(&pending).Error; err != nil {
		log.Printf("[INVENTORY] load back-in-stock queue: %v", err)
		return
	}
	if len(pending) == 0 {
		return
	}

	for _, entry := range pending {
		lines, err := h.loadStockLines(ctx, h.DB, []OrderItemRequest{{
			ProductID:     entry.ProductID,
			ProductSizeID: entry.ProductSizeID,
			Quantity:      1,
		}})
		if err != nil || len(lines) == 0 {
			continue
		}
		line := lines[0]
		if line.Tracked && line.Available < 1 {
			continue
		}

		var product models.Product
		if err := h.DB.WithContext(ctx).Select("id, name, slug").First(&product, entry.ProductID).Error; err != nil {
			continue
		}
		if err := h.emailService().SendBackInStockEmail(entry.Email, product.Name, product.Slug); err != nil {
			log.Printf("[EMAIL] back-in-stock: %v", err)
			continue
		}
		now := time.Now()
		if err := h.DB.WithContext(ctx).Model(&models.BackInStockRequest{}).
			Where("id = ?", entry.ID).
			UpdateColumn("notified_at", &now).Error; err != nil {
			log.Printf("[INVENTORY] mark notified: %v", err)
		}
		if entry.UserID != nil {
			pid := product.ID
			h.pushNotice(ctx, entry.UserID, "offer", product.Name+" is back in stock",
				"The size you asked about is available again.", "/product/"+product.Slug,
				"restock:"+strconv.FormatUint(uint64(entry.ID), 10), nil, &pid, nil)
		}
	}
}

// AdjustStock is the admin endpoint for correcting inventory after a
// physical count, a delivery of new plants, or breakage.
func (h *Handler) AdjustStock(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ProductID     uint   `json:"productId"`
		ProductSizeID *uint  `json:"productSizeId,omitempty"`
		Stock         *int   `json:"stock"` // absolute value
		Delta         *int   `json:"delta"` // relative adjustment
		Reason        string `json:"reason,omitempty"`
	}
	if !httpjson.Decode(w, r, &req) {
		return
	}
	if req.ProductID == 0 {
		httpjson.Error(w, http.StatusBadRequest, "productId is required")
		return
	}
	if (req.Stock == nil) == (req.Delta == nil) {
		httpjson.Error(w, http.StatusBadRequest, "provide exactly one of stock or delta")
		return
	}

	table, id := "products", req.ProductID
	if req.ProductSizeID != nil {
		table, id = "product_sizes", *req.ProductSizeID
	}

	var assignment string
	var arg int
	if req.Stock != nil {
		if *req.Stock < 0 {
			httpjson.Error(w, http.StatusBadRequest, "stock cannot be negative")
			return
		}
		assignment, arg = "?", *req.Stock
	} else {
		assignment, arg = "GREATEST(s.stock + ?, 0)", *req.Delta
	}
	// prev is the pre-update row, so we can tell a real restock (empty →
	// available) from a tweak of a count that was already above zero.
	var changed []struct {
		PrevStock int `gorm:"column:prev_stock"`
		NewStock  int `gorm:"column:new_stock"`
	}
	err := h.DB.WithContext(r.Context()).Raw(fmt.Sprintf(`
		UPDATE %s AS s
		SET stock = %s, updated_at = NOW()
		FROM (SELECT id, stock FROM %s WHERE id = ?) AS prev
		WHERE s.id = prev.id
		RETURNING prev.stock AS prev_stock, s.stock AS new_stock
	`, table, assignment, table), arg, id).Scan(&changed).Error
	if err != nil {
		log.Printf("[INVENTORY] adjust stock: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "failed to adjust stock")
		return
	}

	var actor uint
	if claims, ok := appauth.FromContext(r.Context()); ok {
		actor = claims.UserID
	}
	log.Printf("[INVENTORY] stock adjusted on %s#%d by user %d (reason: %s)", table, id, actor, req.Reason)
	h.invalidateCatalog(r.Context())
	if len(changed) == 1 && changed[0].PrevStock <= 0 && changed[0].NewStock > 0 {
		h.notifyBackInStock(r.Context(), []restockTarget{{
			ProductID: req.ProductID,
			SizeID:    req.ProductSizeID,
		}})
	}

	httpjson.JSON(w, http.StatusOK, map[string]any{"success": true})
}

// ListLowStock reports items at or below their low-stock threshold, so ops
// know what to propagate or reorder.
func (h *Handler) ListLowStock(w http.ResponseWriter, r *http.Request) {
	type row struct {
		ProductID uint   `json:"productId"`
		SizeID    *uint  `json:"productSizeId,omitempty"`
		Name      string `json:"name"`
		Slug      string `json:"slug"`
		Stock     int    `json:"stock"`
		Threshold int    `json:"threshold"`
	}
	var rows []row
	if err := h.DB.WithContext(r.Context()).Raw(`
		SELECT p.id AS product_id, NULL::bigint AS size_id, p.name, p.slug, p.stock,
		       p.low_stock_threshold AS threshold
		FROM products p
		WHERE p.deleted_at IS NULL AND p.track_inventory = true
		  AND p.stock <= p.low_stock_threshold
		  AND NOT EXISTS (SELECT 1 FROM product_sizes s WHERE s.product_id = p.id AND s.deleted_at IS NULL)
		UNION ALL
		SELECT p.id AS product_id, s.id AS size_id,
		       p.name || ' (' || s.label || ')' AS name, p.slug, s.stock,
		       p.low_stock_threshold AS threshold
		FROM product_sizes s
		JOIN products p ON p.id = s.product_id
		WHERE s.deleted_at IS NULL AND p.deleted_at IS NULL AND p.track_inventory = true
		  AND s.stock <= p.low_stock_threshold
		ORDER BY stock ASC
		LIMIT 200`).Scan(&rows).Error; err != nil {
		log.Printf("[INVENTORY] low stock: %v", err)
		httpjson.Error(w, http.StatusInternalServerError, "failed to load low stock")
		return
	}
	httpjson.JSON(w, http.StatusOK, map[string]any{"items": rows, "count": len(rows)})
}
