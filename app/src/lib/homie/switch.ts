// homie's voice, on or off, in one place (Caleb, Oct 29: "I want to remove the voice agent. Don't delete any code.
// Essentially, just disable that feature for now"). Off: no pot on any screen (app/_layout), no voice while she
// records (app/recording films and sends through Convex alone, lib/live/quietRecording), no voice cook mode
// (app/cook: Back and Next by touch), no speak() (lib/live/speak), and a question row answers by typing or a
// voice note (components/parent/LiveQuestions). No socket and no mic stream opens, so no Cartesia credits burn.
// Turning homie back on is this one line.
export const HOMIE_ON = false;
