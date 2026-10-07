# Class booking and waiting list

A class on the timetable repeats weekly. Give it a number of places (**Class bookings** in the admin rail, by a registrar, administrator or owner) and members book a place on a particular date, up to 14 days ahead. A class with no number is not booked: people just turn up, and it does not appear on the booking screen.

- **Who can book**: a person on that club's roll, or a parent for their child, for classes their age and grade allow. People who have left the club cannot.
- **Full**: further people join a waiting list and see their number in the queue.
- **Cancelling**: one press, up to the class. The person who has waited longest moves up at once and is written to. Raising the number of places brings people up from the list the same way.
- **Races**: places are counted while the class is locked, so six people pressing at once for three places get exactly three.
- **The club** sees, for each class and date, who is booked and who is waiting.
- Tables: `class_booking`, `training_session.capacity` (migration 045). Rules in `packages/core/domain/booking.mjs`.

Not done: charging per class, and marking a booked person present automatically when they check in (the roll and check-in work as before).
