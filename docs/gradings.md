# Grading events

A grading is an event of kind *grading* (scheduled under Events). `/o/:slug/gradings` lists those a club or federation can see; each has three stages.

1. **Enter.** A club registrar ticks members. Only members who meet the syllabus (months at grade, training sessions from the roll, minimum age) can be ticked; anybody else is refused by name with what is missing. The fee is set by the organiser. A kyu grading fee becomes a payment to the member's club; a black belt fee becomes a payment to the federation (`kyu_grading` / `dan_grading`). Withdrawing voids an unpaid fee; a withdrawn member can be entered again. Entries close with the event's entry window.
2. **Record.** The organiser (whoever runs the event: a club for kyu, the federation for black belt) picks each entrant's result — passed, provisional, did not pass, did not attend — and names the examining panel by member number.
3. **Finalise.** One step, all or nothing: the panel is checked against the grade's authority rule (size and seniority, e.g. three 4th dans for black belt), each pass goes into the register, a certificate number (`MOKNZ-G-2026-0001`, one count per federation per year) is issued, fails are kept as history, and the event is marked completed. A missing result or a panel that is too junior changes nothing.

**Certificates** are a printable page (`/p/:id/certificate/:recordId`; print or save as PDF from the browser). The member or their guardian can open their own (linked from their page); so can staff at the awarding organisation or the member's club. Fails and uncertified records have none.

The older **Grading** page remains for recording a result with no event behind it.
