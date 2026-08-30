# Social preview

`social-preview.png` is the repository's social card — what renders when the repo link is
shared on X, Slack, LinkedIn or in a GitHub embed. 2560x1280 (2x of GitHub's recommended
1280x640), 683 KB, under GitHub's 1 MB limit.

It is **not** applied automatically. GitHub has no API for it, so upload it by hand:
**Settings -> General -> Social preview -> Edit -> Upload an image**.

## Regenerating

`social-preview.html` is the source. Colours come from the `terminal-neon` theme in
`skills/design-kit/themes/`, so a theme change can be carried across by hand.

```bash
chrome --headless --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=2 --window-size=1280,640 \
  --screenshot=social-preview.png .github/assets/social-preview.html
```

Check the render at thumbnail size before shipping it — a social card is read at about
600 px wide, not at full size.

Update the counts in the card whenever the skill or agent count changes.

# Demo

`demo.gif` shows one install wiring the same skills into Claude Code, Codex and Cursor.
1420x600, 280 KB.

## Regenerating

`demo.tape` is the source, for [vhs](https://github.com/charmbracelet/vhs) (`brew install vhs`).
It runs against a throwaway `$HOME` and never touches your real config; the clone is warmed in a
hidden phase so the visible run shows only the linking.

```bash
cd .github/assets && vhs demo.tape
```

Re-record it whenever the installer's output changes, and check the last frame before shipping —
long skill names wrap if `Set Width` is too small.
