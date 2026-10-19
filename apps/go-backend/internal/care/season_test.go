package care

import (
	"testing"
	"time"
)

func TestSeasonByMonth(t *testing.T) {
	cases := []struct {
		month time.Month
		want  Season
	}{
		{time.January, Winter},
		{time.April, Summer},
		{time.July, Monsoon},
		{time.October, PostMonsoon},
	}
	for _, tc := range cases {
		got := For(time.Date(2026, tc.month, 15, 12, 0, 0, 0, time.UTC))
		if got.Season != tc.want {
			t.Fatalf("%s: got %s, want %s", tc.month, got.Season, tc.want)
		}
		if got.Title == "" || len(got.Tasks) == 0 || len(got.GuideSlugs) == 0 {
			t.Fatalf("%s: advice is incomplete", tc.month)
		}
	}
}

func TestNextDueMorningIST(t *testing.T) {
	loc, err := time.LoadLocation("Asia/Kolkata")
	if err != nil {
		t.Fatal(err)
	}
	from := time.Date(2026, time.October, 18, 21, 0, 0, 0, loc)
	got := NextDue(from, 7)
	if got == nil {
		t.Fatal("expected a due time")
	}
	want := time.Date(2026, time.October, 25, 8, 0, 0, 0, loc)
	if !got.Equal(want) {
		t.Fatalf("got %s, want %s", got, want)
	}
	if NextDue(from, 0) != nil {
		t.Fatal("zero interval should disable the reminder")
	}
	if !IsDue(got, want) || IsDue(got, want.Add(-time.Minute)) {
		t.Fatal("IsDue boundaries are wrong")
	}
}
