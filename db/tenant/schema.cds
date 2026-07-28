// Aggregates the Tenant Layer model. Deployed independently into each tenant's own
// database — never merged into the app's default (Master DB) model. See
// lib/provisioning/capDeploy.js for how this gets loaded and deployed at runtime.
using from './role';
using from './user';
using from './permission';
using from './sap';
using from './rules';
using from './alerts';
using from './reviews';
using from './scheduler';
using from './dashboard';
using from './reports';
