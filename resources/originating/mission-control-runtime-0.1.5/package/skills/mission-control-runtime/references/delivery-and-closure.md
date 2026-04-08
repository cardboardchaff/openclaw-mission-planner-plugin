# Delivery and Closure

## Closure rule

Do not close a ticket as `succeeded` unless the success measure is met.

## Delivery rule

If the task includes telling the user when it is done, delivery is part of done.

That means:
- sending is not the same as delivery
- if delivery can be verified, verify it
- if delivery cannot be verified, say so plainly

## Practical rule

Use `ticket_update` while evidence is still arriving.
Use `ticket_close` only after:
- the outcome exists
- the evidence exists
- delivery obligations are either verified or explicitly unresolved
