namespace xyra.tenant;

using { cuid, managed } from '@sap/cds/common';

// Org dimensions used to classify Systems and filter reports (Region Based Report,
// Platform Based Report, Sector filters in the SOP's dashboards). Genuinely
// tenant-configurable — a company adds new business platforms/sectors over time —
// so these stay real tables, not enums.
//
// ponytail: the source spec gives each of these its own *_HISTORY twin table for
// audit trail. `managed` already carries modifiedAt/modifiedBy per row; a full
// change history for config data this rarely-changed and low-volume is tracked in
// ReferenceChangeLog below instead of one near-identical history table per entity.

// code widened to 50 (from an initial 10) — Configuration's Add/Edit System
// dialog captures Region/Platform/Sector as one free-text field (e.g. "North
// America"), not a short code, and that value doubles as the code here.
@assert.unique: { code: [ code ] }
entity Regions : cuid, managed {
    code        : String(50) not null;
    description : String(100) not null;
}

@assert.unique: { code: [ code ] }
entity Platforms : cuid, managed {
    code        : String(50) not null;
    description : String(100) not null;
}

@assert.unique: { code: [ code ] }
entity Sectors : cuid, managed {
    code        : String(50) not null;
    description : String(100) not null;
}

// Reviewer's stated root-cause when approving/rejecting a deviation (SOP 6.3.1.4/6.3.1.7).
@assert.unique: { code: [ code ] }
entity ReasonCodes : cuid, managed {
    code        : String(10) not null;
    description : String(200) not null;
}

// One shared audit log for changes to the reference tables above, instead of a
// separate history table per entity like the source spec had — same shape
// repeated four times over.
entity ReferenceChangeLog : cuid, managed {
    entityName : String(30) not null; // 'Regions' | 'Platforms' | 'Sectors' | 'ReasonCodes'
    recordCode : String(10) not null;
    action     : String(10) not null; // ADD, EDIT, DELETE
    oldValue   : String(200);
    newValue   : String(200);
}
