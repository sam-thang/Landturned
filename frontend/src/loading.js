// The loading steps and progress bar in the LOCATING panel.
// Every step has a list item (<li id="step-NAME">). The single bar is split into equal shares,
// one per step, in the order the steps appear in the list.
// Steps are marked as running and done when real events happen, never on a fake timer.

const stepsList = document.getElementById('steps'); // The list of steps
const fill = document.querySelector('#progress i'); // The colored fill inside the progress bar

// The step names in list order, e.g. ['locate', 'map'], taken from the ids "step-locate", "step-map"
const order = [...stepsList.querySelectorAll('li')].map((item) => item.id.replace('step-', ''));

// Find the list item for a step, e.g. "map" → <li id="step-map">
function stepItem(id) {
  return document.getElementById(`step-${id}`); // Look it up by its id
} // End of stepItem

// How far along the bar (in %) a step ends: with 2 steps, "locate" ends at 50% and "map" at 100%
function endOf(id) {
  return ((order.indexOf(id) + 1) / order.length) * 100; // (position in the list, counting from 1) ÷ (number of steps) × 100
} // End of endOf

// Move the bar's fill to a width (in %), animating with the given CSS transition
function moveFill(percent, transition) {
  void fill.offsetWidth; // Make the browser apply any earlier change first, so this change animates from the right place
  fill.style.transition = transition; // How to animate (duration and easing)
  fill.style.width = `${percent}%`; // Where to go
} // End of moveFill

// Put every step back to "not started" and empty the bar, instantly (no animation)
export function resetSteps() {
  for (const item of stepsList.querySelectorAll('li')) { // Every step in the list
    item.classList.remove('running', 'done', 'failed'); // Not running, done, or failed
  } // End of the steps loop
  moveFill(0, 'none'); // Empty the bar with no animation
} // End of resetSteps

// Mark a step as running. If we know how long it will take (like the globe turn),
// the bar fills up to the end of this step's share smoothly over exactly that time;
// otherwise the bar waits at the end of the previous step until finishStep.
export function startStep(id, knownDurationMs) {
  stepItem(id).classList.add('running'); // Show it as in progress (muted text with a pulsing "…")
  if (!knownDurationMs) return; // Unknown duration: the bar moves only when the step really finishes
  moveFill(endOf(id), `width ${knownDurationMs}ms cubic-bezier(0.65, 0, 0.35, 1)`); // Same timing and easing curve as the globe's turn (easeCubicInOut)
} // End of startStep

// Mark a step as done: white text with a green ✓, and the bar filled to the end of this step's share
export function finishStep(id) {
  const item = stepItem(id); // This step's list item
  item.classList.remove('running'); // No longer in progress
  item.classList.add('done'); // Done
  moveFill(endOf(id), 'width 0.4s ease-out'); // Fill the rest of this step's share quickly
} // End of finishStep

// Mark a step as failed: grey text with a dash instead of a ✓, and new text saying what went wrong.
// The bar still moves on, because the step is over (it just didn't work).
export function failStep(id, text) {
  const item = stepItem(id); // This step's list item
  item.classList.remove('running'); // No longer in progress
  item.classList.add('failed'); // Failed
  item.textContent = text; // Replace the step's text with the explanation
  moveFill(endOf(id), 'width 0.4s ease-out'); // Fill the rest of this step's share quickly
} // End of failStep
