/** Group the complete console feed into frame records. The final settle is
 * identified by its token and 0..N-1 sample indices, never by taking the last
 * N tally lines (which can borrow a preview or an earlier pose). A tally or
 * failure line tagged `sample=k` is a sphere-inversion joint pool's report
 * for an EARLIER sample of the same job (the last sample's pool finishes
 * them all), so it is filed under that sample's frame. */
export function traceFrames(lines) {
  const frames = [];
  let current = null;
  for (const line of lines) {
    if (line.includes("frame start ")) {
      const field = (name) =>
        new RegExp(`(?:^| )${name}=([^ ]+)`).exec(line)?.[1];
      current = {
        start: line,
        rays: Number(field("rays")),
        sample: Number(field("sample")),
        samples: Number(field("samples")),
        token: Number(field("token")),
        tallies: [],
        failureClasses: {},
        completed: false,
      };
      frames.push(current);
    }
    if (!current) continue;
    // The frame a line belongs to: its own, or a tagged earlier sample of
    // the same job. A tag naming no such frame files nowhere, so the
    // sample it should have completed reads as missing its tally.
    const tagged = /(?:final|failures) sample=(\d+) /.exec(line);
    const owner = tagged
      ? frames.find(
          (f) => f.token === current.token && f.sample === Number(tagged[1]),
        )
      : current;
    if (!owner) continue;
    if (line.includes("transport failures ")) {
      for (const match of line.matchAll(/(f\d+\/r\d+)=(\d+)/g)) {
        owner.failureClasses[match[1]] = Number(match[2]);
      }
    }
    const tally =
      /transport done final (?:sample=\d+ )?resolved=(\d+) unresolved=(\d+) \(cumulative resolved=(\d+) unresolved=(\d+) invalid=(\d+)\) passes=(\d+)(?: skipped=(\d+))?/.exec(
        line,
      );
    if (tally)
      owner.tallies.push({
        resolved: Number(tally[1]),
        unresolved: Number(tally[2]),
        cumulativeResolved: Number(tally[3]),
        cumulativeUnresolved: Number(tally[4]),
        invalid: Number(tally[5]),
        passes: Number(tally[6]),
        // Classic-slot hits (shadeRays owns them): the glass solid's
        // opaque-first pixels under per-map media. Absent on older feeds.
        skipped: Number(tally[7] ?? 0),
      });
    const done =
      /frame done .*truncated=(true|false) hit=(\d+) miss=(\d+) exhausted=(\d+) active=(\d+) plane=(\d+)/.exec(
        line,
      );
    if (done) {
      current.completed = true;
      current.truncated = done[1] === "true";
      current.hit = Number(done[2]);
      current.miss = Number(done[3]);
      current.exhausted = Number(done[4]);
      current.active = Number(done[5]);
      current.plane = Number(done[6]);
      current.wallMs = Number(/^\[(\d+)ms\]/.exec(line)?.[1]);
    }
  }
  return frames;
}

/** Strict full-frame completion, shared by preset and lifecycle gates. */
export function completionFailures(frames, samples, rays) {
  const errors = [];
  const last = frames.at(-1);
  if (!last || !Number.isInteger(last.token))
    return ["missing identified final frame"];
  const final = frames.filter((frame) => frame.token === last.token);
  if (final.length !== samples)
    errors.push(`final token has ${final.length}/${samples} antialias samples`);
  for (let i = 0; i < final.length; i++) {
    const frame = final[i];
    const label = `sample ${i}`;
    if (frame.sample !== i || frame.samples !== samples)
      errors.push(`${label}: stale, duplicate or missing sample identity`);
    if (!frame.completed || frame.truncated)
      errors.push(`${label}: frame incomplete or truncated`);
    if (frame.rays !== rays)
      errors.push(`${label}: raster differs from settled census`);
    if (frame.active !== 0 || frame.exhausted !== 0)
      errors.push(`${label}: active or exhausted march work`);
    if (
      frame.hit + frame.miss + frame.exhausted + frame.active + frame.plane !==
      frame.rays
    )
      errors.push(`${label}: inconsistent march accounting`);
    if (frame.tallies.length !== 1) {
      errors.push(`${label}: expected exactly one final transport tally`);
      continue;
    }
    const tally = frame.tallies[0];
    if (tally.resolved <= 0 || tally.passes <= 0)
      errors.push(`${label}: no resolved optical work`);
    if (tally.unresolved !== 0 || tally.invalid !== 0)
      errors.push(
        `${label}: unresolved=${tally.unresolved} invalid=${tally.invalid}`,
      );
    if (
      tally.resolved + tally.unresolved + tally.invalid + tally.skipped !==
      frame.hit
    )
      errors.push(
        `${label}: optical tally does not account for every glass hit`,
      );
  }
  return errors;
}
