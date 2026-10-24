# glasses

The ESP32 glasses stream to a small Google Cloud VM. The VM saves the stream while the cook records on her
phone, and when she says "I'm done" it makes one MP4, uploads it and queues the Convex job. The protocol the
firmware speaks is in [INGEST.md](INGEST.md).

```
ingest/server.py        the VM's service: WS /ingest, GET /frame/latest, GET /health, polls Convex every 2 s
ingest/store.py         one recording on disk (frames + PCM + meta.json), appended as it arrives
ingest/mux.py           frames at their real times → 15 fps H.264, PCM → AAC (ffmpeg)
ingest/cloud.py         Convex /glasses/* and the GCS upload
ingest/fake_glasses.py  replay any video as the glasses would send it
ingest/convex_stub.py   a stand-in for Convex's /glasses/* routes
ingest/e2e_test.py      the local end-to-end test (no cloud)
vm/setup.sh             create or update the VM; vm/startup.sh runs on its every boot
```

The Convex side is `convex/glasses.ts` and `convex/lib/glassesRoutes.ts` (`/glasses/active`,
`/glasses/finished`, contract in `docs/build/STACK.md`).

## Test it on a laptop

Needs ffmpeg and the repo's `.venv` (it has `websockets`).

```bash
.venv/bin/python glasses/ingest/e2e_test.py
```

It makes a 6 s test video, streams it with one dropped connection, ends the recording in the stub, and checks the
MP4 has H.264 video and AAC audio of 6 s and that `/glasses/finished` got the right body. Nothing is uploaded.

By hand, against the real Convex (it reads which recording is live, and creates the job at the end):

```bash
set -a; . ./.env; set +a
.venv/bin/python glasses/ingest/server.py --dir /tmp/glasses --port 8090 --dry-upload   # drop --dry-upload to upload
.venv/bin/python glasses/ingest/fake_glasses.py some-cooking-video.mp4 --url ws://localhost:8090
```

Without `--dry-upload` a laptop uploads with your own `gcloud auth print-access-token`; the VM uses its service
account. With `--dry-upload` it still calls `/glasses/finished`, so the worker will look for a file that isn't there.

## The VM

`glasses/vm/setup.sh --dry-run` prints every command. `glasses/vm/setup.sh` creates what's missing: a service
account that may only add objects to the uploads bucket, a firewall rule for tcp:8090, a reserved IPv4, and an
e2-micro in us-west1-b (Free Tier) running Debian 12. Its startup script installs ffmpeg and a Python venv with
`websockets` (pinned in `ingest/requirements.txt`; Debian's own package is too old), copies `ingest/` from the
VM's metadata, writes `/etc/glasses.env` and starts the `glasses` systemd unit. Run it again to push new code
(it restarts the VM, so not during a recording).

```bash
curl http://<VM_IP>:8090/health
gcloud compute ssh glasses-ingest --zone us-west1-b --command 'journalctl -u glasses -f'
```

An e2-micro has a quarter of a core, so making the MP4 takes a while after "I'm done" (ultrafast preset). It
hasn't been timed on the VM yet: the log line `made out.mp4 (… s of video) in N s` says how long it took. The job
appears in the app once the upload is done.

## Keys

| Key | Where |
|---|---|
| `GLASSES_SECRET` | Convex env, the VM (`/etc/glasses.env`), the voice service (Cloud Run secret) |
| `GLASSES_DEVICE_KEY` | the VM and the firmware (`?device=`) |
| `GLASSES_URL` | the voice service (Cloud Run env): `http://<VM_IP>:8090` |
