// Asks the runner's trustd wait (scripts/journey-trust-wait.mjs, on 127.0.0.1 during ios-journeys) whether to go on.
// It answers "ready" or "wait" within 5 s; flows/trustd-ready.yaml asks again until "ready". With no server (Maestro run
// anywhere else), it's "ready" at once, and the log says so.
try {
  const r = http.get(`http://127.0.0.1:47231/trustd-ready?mode=${MODE}&why=${encodeURIComponent(WHY)}`);
  output.trustd = r.body && r.body.trim() === 'wait' ? 'wait' : 'ready';
} catch (e) {
  output.trustd = 'ready';
  console.log('trustd wait: no server on 127.0.0.1:47231, so not waited');
}
