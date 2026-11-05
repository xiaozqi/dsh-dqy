# Game templates

Template-driven game assets. Each game gets one subfolder; every PNG inside is
a match target whose label is the file name without extension.

## Convention

```
templates/
└── happy-match/              # game id passed to GameService
    ├── play-button.png       # label: play-button
    ├── close.png             # label: close (finish label by default)
    └── success.png           # label: success (finish label by default)
```

- Capture templates from real screenshots at the device resolution; crop tight
  around the target.
- Matching uses OpenCV `TM_CCOEFF_NORMED`; the default threshold is 0.85.
- Labels listed in `finishLabels` end the run immediately when matched.
- Decision logic is a `GamePolicy`. `PriorityTapPolicy` taps the highest-priority
  match; implement the interface for board-level analysis (e.g. grid detection
  for match-3 games).
