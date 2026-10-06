# Member portal

Signed-in people see themselves and the children they look after (`family.mayActFor`), nothing else.

| Screen | Route | What it shows |
|---|---|---|
| Home | `/me` | Per person: action required, membership (with the club's place in the hierarchy and fee standing), current grade, next class they may attend, next event, payments owed, documents, training count. Latest messages. |
| Messages | `/me/messages`, `/me/messages/:id` | What clubs sent them, or sent them about a child. Opening one marks it read; someone else's message is "not found". |
| Classes | `/me/classes` | The timetable of their clubs, with which classes are for them (age and grade limits). |
| Record | `/me/:personId/record` | Grade history with certificates, attendance, upcoming and past events with entry status and not-paid flag. |
| Documents | `/me/:personId/documents` | Certificates, qualifications with expiry, declarations signed (with the exact text and who agreed), receipts. |
| Details | `/me/:personId` | Contact, address, emergency contact, medical notes (editable). |
| Events | `/me/events` | Open events; one click when nothing changed (see entering-events.md). |
| Payments | `/me/payments` | What is owed, and history. |

"Action required" is worked out, not stored: payments owed, membership overdue or due within 30 days,
entries closing within 7 days, qualifications expired or expiring, no emergency contact.

## Not built yet
Booking and cancelling classes (needs capacity), event results (needs the tournament engine), push
notifications, the digital membership card with QR, uploading a certificate file.
