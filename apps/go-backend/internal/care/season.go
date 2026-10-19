// Package care holds plant-care rules that do not depend on the database:
// Indian seasons, and when the next watering or fertilizing reminder falls.
package care

import "time"

// Season is one of the four growing periods used for advice in India.
type Season string

const (
	Winter      Season = "winter"
	Summer      Season = "summer"
	Monsoon     Season = "monsoon"
	PostMonsoon Season = "post_monsoon"
)

// Advice is what the app shows for the current season.
type Advice struct {
	Season          Season   `json:"season"`
	Title           string   `json:"title"`
	Summary         string   `json:"summary"`
	WateringNote    string   `json:"wateringNote"`
	FertilizingNote string   `json:"fertilizingNote"`
	Tasks           []string `json:"tasks"`
	GuideSlugs      []string `json:"guideSlugs"`
	ShopCategories  []string `json:"shopCategories"`
}

// For returns seasonal care for t, using the calendar month. Advice is written
// for Indian homes and balconies, where summer heat and the monsoon change
// the routine more than the date on a temperate calendar would.
func For(t time.Time) Advice {
	switch t.Month() {
	case time.December, time.January, time.February:
		return Advice{
			Season:          Winter,
			Title:           "Winter care",
			Summary:         "Growth slows and pots stay damp longer. Water less often, keep plants out of cold draughts, and hold off heavy feeding.",
			WateringNote:    "Check the soil before watering. Many indoor pots only need water every 7–10 days.",
			FertilizingNote: "Feed lightly, or skip fertilizing until new growth starts.",
			Tasks: []string{
				"Move balcony plants away from cold night wind.",
				"Water in the morning so foliage dries before evening.",
				"Wipe dust off indoor leaves so they can use the weaker light.",
			},
			GuideSlugs:     []string{"how-often-to-water-indoor-plants", "best-indoor-plants-for-indian-homes"},
			ShopCategories: []string{"indoor-plants"},
		}
	case time.March, time.April, time.May:
		return Advice{
			Season:          Summer,
			Title:           "Summer care",
			Summary:         "Heat and dry air pull moisture out of pots quickly. Shade midday sun and water by checking the soil, not by a fixed summer habit.",
			WateringNote:    "Check pots every two or three days. Water thoroughly when the top few centimetres are dry.",
			FertilizingNote: "A light feed every 3–4 weeks is enough while plants are growing. Do not feed a plant that is heat-stressed.",
			Tasks: []string{
				"Shift pots back from west-facing glass in the afternoon.",
				"Mulch outdoor pots so the surface does not bake.",
				"Keep plants out of the direct blast of a cooler or AC vent.",
			},
			GuideSlugs:     []string{"outdoor-and-balcony-plant-care-in-india", "how-often-to-water-indoor-plants"},
			ShopCategories: []string{"outdoor-plants", "indoor-plants"},
		}
	case time.June, time.July, time.August, time.September:
		return Advice{
			Season:          Monsoon,
			Title:           "Monsoon care",
			Summary:         "Humidity stays high and soil dries slowly. The usual summer watering routine is the fastest way to rot roots now.",
			WateringNote:    "Wait until the top of the soil is dry. Outdoor pots may not need watering for a week after rain.",
			FertilizingNote: "Pause fertilizing while the soil stays wet. Feed again once the rains ease.",
			Tasks: []string{
				"Tip excess water out of saucers and cache pots.",
				"Watch for fungus gnats and yellowing from wet roots.",
				"Give indoor plants air; do not crowd them against a damp wall.",
			},
			GuideSlugs:     []string{"how-often-to-water-indoor-plants", "outdoor-and-balcony-plant-care-in-india"},
			ShopCategories: []string{"indoor-plants"},
		}
	default:
		return Advice{
			Season:          PostMonsoon,
			Title:           "After the rains",
			Summary:         "October and November are the easiest months to reset a collection: repot, resume feeding, and set a watering rhythm before summer.",
			WateringNote:    "Return to watering when the top few centimetres dry out, usually every 4–7 days indoors.",
			FertilizingNote: "Resume a monthly feed for plants that are putting out new leaves.",
			Tasks: []string{
				"Repot anything that is root-bound, while the weather is mild.",
				"Prune damaged monsoon growth.",
				"Set watering and fertilizing reminders before the routine slips.",
			},
			GuideSlugs:     []string{"outdoor-and-balcony-plant-care-in-india", "best-indoor-plants-for-indian-homes"},
			ShopCategories: []string{"outdoor-plants", "fruit-plants"},
		}
	}
}

// India returns t in Asia/Kolkata, falling back to t unchanged if the zone
// data is missing from the host.
func India(t time.Time) time.Time {
	loc, err := time.LoadLocation("Asia/Kolkata")
	if err != nil {
		return t
	}
	return t.In(loc)
}

// NextDue is the next 8:00 IST reminder, everyDays after from. Zero or
// negative intervals mean the reminder is off.
func NextDue(from time.Time, everyDays int) *time.Time {
	return NextDueAt(from, everyDays, 8)
}

// NextDueAt is NextDue at a chosen hour in Asia/Kolkata. Hours outside 0–23
// fall back to 8:00.
func NextDueAt(from time.Time, everyDays, hour int) *time.Time {
	if everyDays <= 0 {
		return nil
	}
	if hour < 0 || hour > 23 {
		hour = 8
	}
	t := India(from).AddDate(0, 0, everyDays)
	due := time.Date(t.Year(), t.Month(), t.Day(), hour, 0, 0, 0, t.Location())
	return &due
}

// IsDue reports whether a reminder time has arrived, compared in IST.
func IsDue(next *time.Time, now time.Time) bool {
	if next == nil {
		return false
	}
	return !India(*next).After(India(now))
}
