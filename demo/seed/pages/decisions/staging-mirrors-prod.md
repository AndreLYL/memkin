---
title: "Staging environment mirrors production topology"
type: decision
---
Staging runs the same topology as production — same services, smaller instances — so
launch rehearsals for [[entities/project-phoenix]] are trustworthy.
[[entities/bob-martinez]] encoded it in [[entities/terraform]];
review tracked in [[tasks/review-bob-terraform-pr]].
