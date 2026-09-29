# Hospital assistant

## Language

**Agent turn**:
One user request and the assistant work that follows it, owned by its original conversation. Only one turn may be active across the app. The turn itself saves the request and its reply (answered, stopped, or failed) to the conversation; a failed person lookup leaves the answer unenriched rather than failing the turn.

**Stopped turn**:
A turn ended by the user, retaining partial text and completed tool results. Unfinished tool calls are excluded from subsequent conversation replay.

**Conversation memory**:
What an agent turn is given besides the new request: the recent messages of its conversation in full (with their tool calls), one summary of older messages, and only the saved memory lines relevant to the request. Older messages are folded into the summary after a turn is saved.

**Display result**:
The successful table, chart, export, or statistical analysis output that supports the final answer. The latest successful result is the draft selection; final review may select an earlier matching result.

**Final answer review**:
A check that the answer addresses the request and agrees with the successful evidence and chosen display result. It allows one correction and one recheck; an unavailable or unsuccessful check is explicitly marked as unverified.

**SQL privacy decision**:
A decision covering every projected expression before a hospital query runs. Missing or invalid decisions mean the query cannot run.
