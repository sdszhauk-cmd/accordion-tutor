# Score accuracy checks

Run from the repository root with Node 22.13 or newer:

```sh
npm install
npx playwright install chromium
npm run test:accuracy
```

Set `CHROMIUM_PATH` to use an existing Chromium executable. The suite serves the repository sources inside the browser test and can run offline once dependencies are installed.

Both parsers receive the same XML. The control uses the two-bar score from the standalone **Load Sample** button. The other fixtures exercise six eighth notes followed by a new downbeat, and explicit left-hand silence followed by a new chord. The expected event tables are in `accuracy.cjs`. Offsets and durations are in quarter notes. A separate check uploads the no-chord fixture in the standalone interface, steps forward and reads the highlighted diagram elements.

At baseline `5dfa4b1`, both sample controls passed. Both parsers placed the second 6/8 measure at quarter 6 instead of quarter 3. Both prescribed the C-major button at quarter 1 of the no-chord fixture, and the standalone diagram highlighted it. These checks measure native MusicXML interpretation. PDF recognition needs separate paired inputs.
