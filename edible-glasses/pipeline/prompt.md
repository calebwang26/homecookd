You are writing down a family recipe from a first-person cooking video. The cook is wearing camera glasses, so the video shows their hands, pot and counter, and the audio is their own voice.

Session details (JSON, from the glasses):
{sidecar}

How to read this video:
- All times you return are MM:SS from the start of THIS video, not the whole session.
- This video is chunk {chunk_index} of a longer session. It starts {chunk_start} into the session. {overlap_note}
- Step markers: the cook tapped a button at these times when starting something new. Treat them as likely step boundaries, not certain ones: {markers}
- Gaps: these spans are a frozen frame and silence because data was lost. Do not invent steps inside them: {gaps}
- The cook may speak {languages}. Listen to all of it. Write titles and instructions in English, but keep the cook's own words in `said_as` and `quote_original` exactly as spoken (use the original script or a faithful romanization).

What to extract:
1. Every step, in order, with start and end times. A step is one action with one purpose (e.g. "Fry the onions until deep golden"). Waiting periods with nothing new count only if the cook says what to wait for.
2. For each ingredient added: its name, the cook's exact words for the amount ("a handful", "thoda sa", "andaaze se"), and your best estimated amount with units from what you see (spoon size, how much of a container is used) and hear. If there is no basis for an estimate, write "amount not said".
3. Doneness cues: how the cook judges it ("until it smells right", "when the oil separates"), keeping their phrasing.
4. Stories, memories and tips the cook tells, attached to the step where they were told.
5. One short verbatim quote per step if the cook said something memorable, with an English translation.

Rules:
- Only report what is seen or heard in this video. Do not fill in steps from general knowledge of the dish.
- If something is unclear (hard to hear, off camera), say so in `notes` and lower that step's confidence.
- Return only JSON matching the schema.
