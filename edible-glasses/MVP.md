# Cooking day: the short version

Two windows on the laptop, both left open, laptop plugged in, same hotspot as the glasses:

```
~/edible-glasses/tools/run_receiver.sh                                   # 1. saves the glasses' stream
cd ~/hackathon-homecookd && .venv/bin/python pipeline/worker.py          # 2. turns videos into recipes
```

1. Power the glasses on (power-cycle them right before she starts).
2. In the app: **Record a new recipe → Start recording → From my glasses**. Filming starts right away
   (the laptop window says `paired with recording …`).
3. She cooks. Tap **I'm done** when she's finished. It stops right away.
4. Back on Home, a card says "your glasses video is on its way", then **Save to Photos**. Tap it, then
   **Save Video**.
5. **Record a new recipe → Start recording → Videos I took**, pick it, Send. A progress row shows on Home
   until the recipe is ready (a 30-min cook takes about 20–25 min).

If the card never shows up: `~/edible-glasses/tools/make_video.sh` builds the newest recording on the
Desktop. AirDrop it to the phone and do step 5.
