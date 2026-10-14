# The Attendance Report's In and Out are the day's First Punch and Last Punch, taken from the direction-agnostic walk

The Attendance Report showed one figure per day: Time Present, a duration. A manager who wants arrival and departure times had to open each cell's drill-down. The report now shows two labelled times per day. In is the day's First Punch and Out is its Last Punch, both direction-agnostic and pooled across devices. The times come from the existing presence walk, whose span view (`computeDayPunchSpans`) returns the day's endpoints. The report's data source already calls that walk per employee. So Out minus In always equals the presence duration it replaced.

The rejected alternative is the direction-gated derivation that feeds the employee attendance grid. That derivation alternates In and Out across a day's Punches, so an odd-Punch day ends at its second punch. The defect is measured on the fixture set. A day punched 09:02, 12:10 and 18:41 reads 3.13 hours, where the true span is 9.65 hours. 71 of 356 fixture days were wrong under that rule (ADR-0015). So the report takes its endpoints from the walk's own measurement.

The words In and Out now carry two derivations on two screens. On the Attendance Report, In is the First Punch and Out is the Last Punch, direction-agnostic. On the employee attendance grid, In is the first `in` Punch and Out is the last `out` Punch. The grid's derivation is direction-gated, as ADR-0015 records. A reader must not swap the two, because the same words then point at different rules.

The walk merges a next-day Punch into the day that began it, but only under two conditions. It must be chronologically after that day's last Punch, and within 12 hours of that day's first Punch. The merged Punch is consumed, so no Punch counts toward two days. The Out of a merged day shows the next day's clock time. That time reads earlier on the clock than its In. Three places carry the rule: the cell tooltip, the screen-reader text and the note under the matrix.

A lone Punch gets no second endpoint. Its In is that Punch's time and its Out is an em dash. The report never invents a checkout. A day whose only Punch merged into the previous day shows no times. That Punch still counts on its own date.

The glossary now separates these times from the Attendance Record's authored in and out times ([GLOSSARY.md](../../GLOSSARY.md)). Those times are written by a human; these are measured from the device. ADR-0015 used the same discipline when it separated Time Present from Logged Hours. The separation is written down because the same words name both.

Two alternatives were considered. Making the two calculators agree was rejected. The two screens answer different questions, and Payable OT is money priced off the grid's derivation (ADR-0010, ADR-0006). Giving every day a direction-free span everywhere was also rejected. That would rewrite the grid's In and Out columns and Payable OT off an inference the devices never made.

Consequences: the cell contract gains `first_punch`, `last_punch` and `last_punch_next_day`. It loses the presence duration in hours and the merge-refusal flag. The walk still computes the duration and the merge decision internally, and only the wire format shrinks. The legend loses the presence-duration swatch and gains one plain In and Out entry. The note under the matrix keeps the cross-midnight rule and states the lone-Punch rule.

A future reader must not re-derive these times from the Punch list on the page. A future reader must not gate them by direction.
