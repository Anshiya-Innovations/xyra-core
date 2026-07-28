namespace xyra.tenant;

using { cuid, managed } from '@sap/cds/common';

// ponytail: single free-form config blob for now — split into typed widget entities once the dashboard UI needs it.
entity DashboardSettings : cuid, managed {
    config : LargeString; // JSON blob of widget/layout config
}
