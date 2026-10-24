# Kid usability sessions: Caden, Neil, Elliot, Joanna (Oct 21, 2026)

Caleb's notes from four kid-profile sessions, plus the merged plan (Claude + ChatGPT analysis), kept as given.
Section 1 (fix reported failures) is authorized to build. Sections 2–3 are mockup-first: nothing gets built until
Caleb reviews them.

## Caden
- Didn't know what to do in the beginning
- Clicked into family profile
- Confused about the Thursday evening
- Is just at the homepage without clicking anything. Paralyzed
- Clicked into family gc
- Clicked past recipe
- Clicked ask about a dish: confused by 2 pluses in the chat
- Confused by why there's a quote and dad's words
- LOTS of text in the "get these ready" step
- Doesn't care about the quotes
- Did NOT notice the start step button
- Didn't intuitively understand how to flip through steps
- Didn't understand that starting to cook requires clicking a button, just wants to scroll down
- Wants to see all the steps BEFORE going in and looking at each step
- Feels like SO MUCH TEXT. Feels like steps within a step. Hard to follow steps
- Understands the Ask Dad function, intuitively clicks in
- Doesn't understand the point of the eye icon ("is it supposed to be a hint or something")
- Measurements of each material MORE important than the quote. That should be bolded
- Likes the pots at the top of the app
- Knows how to intuitively click into a video and watch
- Wants to be able to go full screen or zoom in on the video
- Wants to be able to go forward and back in the video
- Doesn't need an extra watch function, can already watch at the top
- TOO many instructions, break it down in a more structured way
- Only include quotes if they're actually useful, they don't need to be on every single step
- Wouldn't usually click on "more from Miles", but would click if it specifically said STORY from Miles
- Too much going on in each step. Wants substeps in each step
- Wants to take a picture of the food and send it to someone to show off
- All the buttons feel like distractions from "start cooking"
- EXPECTS the full recipe before starting to cook
- Wants key information (time to cook, 4 bowls) BIGGER
- Wants to see favorited status INSIDE the recipe itself
- Unclear what you're watching and what you're hearing. "Are you watching the entire vid, or just a section?"

## Neil
- Stuck on the homepage, no clear action
- Searched any dish. Viewed dishes by person. Clicked into a dish
- Didn't go into the steps of the dish. Went into chat
- Able to click through recipes
- Overwhelmed by the first page
- Saw the start cooking steps button
- Clicking on profiles, but it doesn't work
- Clicked into the video. Captivated, watched it all the way through
- Clicked into "hear Miles". Would rather hear the voice than the video
- Instead of opening a tab when clicking Hear Miles, it should just play so you can see everything else
- Also can't rewind or adjust the audio
- For Watch, it makes sense that there's a tab
- Confused where to start on the homepage. There should be a "start cooking"
- Unintuitive that you have to go to the Recipes tab to get to recipes
- Start cooking should be the FIRST THING that appears to the user
- Knows how to attach a dish with the plus mark
- The Everyone tab should come before Favorites: what if there are no favorites?
- Should have a tab that sorts by cuisine, a more curated search
- Doesn't know which relative cooks the rice-based dish
- Doesn't even want to click into "tonight's dinner" on the homepage
- Doesn't care about the message circles
- Would want to open up to recipes to start cooking

## Elliot
- Clicked grilled fish on the homepage
- Confused about going back to step 4
- Checked off all the ingredients
- Reading EVERYTHING on the first page. A TON of text, we need to cut redundancy
- Didn't realize they were the ingredients used in that step
- Listened to the voice note, a lot of the way through
- Found the start cooking button
- Didn't know the temperature of the heated pan (medium high or low?)
- Never clicked the Ask family button in the steps
- Really likes the video and the transcript
- Can't scroll down into the transcript
- Wishes he could move the video bar forward or backward
- Found the Ask about the dish button
- Didn't find the + button in messages to ask about a dish (unintuitive)
- Doesn't know how to add a new person in messages
- Didn't know the distinction between cooks and those who eat
- Wants to add feedback or his own notes to the dish
- Noticed the top bar of profiles, but didn't know what it was for
- Never clicked "explore more dishes"
- Likes the videos and quotes
- Wouldn't want to cook his parent's dishes specifically, but would to bond with someone
- Would want to cook and eat the same things as someone he can't see in person: that social aspect

## Joanna
- Confused about what the top profile bar is
- Doesn't understand that the top bar is streaks, sees it as just a way to get to messages
- Clicks the big grilled fish picture. Understood it was the main attraction
- Gets distracted by Dad's words
- Understands the ingredient list
- Confused by the "not sure how much" dropdown
- Found the Start step 1 button
- Found the Hear Miles button. Very attracted to it, possibly because the video button is broken
- Eventually just scrolled through all the steps to the end
- Uses the send function
- In messages, Ask about a dish is intuitive
- "Who's in the kitchen": doesn't understand that it's everyone's accounts; thought it showed what each person cooked
- Didn't understand the quotes in the ingredient list (thought they were for a "homey" feel)
- Only saw the step indicator at the top toward the end
- Dad's quotes are a bit confusing too: extra text a person won't actually read
- Didn't understand the "Everyone, Dad, Grandma" tabs in Recipes

## Merged plan

Goal: make it easy for a kid to find a dish, understand what cooking it involves, and start confidently, while keeping
the voice and video people connected with. The strongest evidence: media engagement and playback friction (all four),
text overload and step-navigation confusion (three), homepage paralysis (two). Individual requests should inform
prototypes without automatically becoming features.

### 1. Fix the reported failures first (authorized to build)
- Reproduce and repair Joanna's broken video button, Neil's unresponsive profile taps and Elliot's unscrollable transcript.
- Check seeking on both video and audio. Make forward/backward control easy to find and use.
- Clearly distinguish "Full video" from "This step."
- Done when these actions work on the kid profile on a real phone, including opening, closing, seeking and returning to the recipe.

### 2. Mock up a simpler cooking journey (mockups first, review before building)
| Area | Proposed change | What to preserve |
|---|---|---|
| Home | Make the large dish card and a clear "Cook this" action the primary entry. Reduce competing prompts. | The prominent dish photo worked for Elliot and Joanna. |
| Recipe overview | Show readable cook time, servings, favorite status, ingredients and a concise numbered preview of every step. Make "Start cooking" easy to find. | Let people understand the recipe before committing to guided mode. |
| Cooking steps | Lead with the instruction. Emphasize quantities, heat and timing; show the ingredients needed for that step. Break dense instructions into short substeps when useful. | Keep related actions together rather than creating dozens of tiny steps. |
| Step navigation | Make current position, next, back and access to all steps obvious. Choose one clear primary navigation pattern. | Users should be able to review earlier instructions without losing their place. |
| Family stories | Keep useful cooking tips beside the action. Put optional stories behind explicit labels such as "Story from Dad." | Elliot liked the quotes; others found them distracting. Preserve access without making everyone read them. |

Design constraint: fewer competing controls and less repeated text. Don't replace every confusing element with another
pill, icon or explanation.

### 3. Make supporting interactions understandable (later)
- People/profile navigation: give the face row a clear purpose. Distinguish browsing someone's recipes from messaging them
  or viewing activity. Test whether the streak row earns space on the first-use homepage.
- Recipe filters: clear labels and selected states. Default to Everyone for users with no favorites.
- Questions and messages: keep "Ask about this dish". Automatically include the dish or step. Make attaching a dish and
  adding a person distinct, discoverable actions.
- Voice playback: listen while reading the recipe, with visible playback and seeking controls.
- Video playback: fullscreen and accessible controls. Remove redundant watch actions.
- Unclear icons and dropdowns: review the eye icon and "Not sure how much?". Replace unclear symbols with useful wording,
  or remove them if they duplicate existing information.

### 4. Validate before expanding
Test with kids who haven't seen the app, without explaining it: choose a dish from Home; find servings, cook time and
ingredients; preview and start cooking; move forward and back to an earlier step; play and seek video or voice while
following the recipe; ask someone a question about the dish.

### 5. Only after the core flow works
1. Personal recipe notes (Elliot). 2. "I made this" photo sharing (Caden; check existing retention postcards first).
3. Cuisine/dish-type discovery (Neil). 4. Cook together from afar (Elliot).
