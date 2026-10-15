//! Bulk assignment reads for the what-if simulator.
//!
//! The simulator needs every object's assignment targets to decide what reaches
//! a device or user. Reading them one object at a time is one Graph call per
//! object, so this walks each collection once with `$expand=assignments` and
//! returns a flat `object id -> drafts` map.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::assignments::{drafts_from_graph_assignments, AssignmentDraft};
use crate::graph::{GraphClient, GraphError};

/// One assignable collection: a Graph path plus how to read its rows.
struct Collection {
    kind: &'static str,
    path: &'static str,
    /// `true` when the collection carries `assignments` as a navigation property.
    expandable: bool,
}

const COLLECTIONS: &[Collection] = &[
    Collection {
        kind: "configurationPolicy",
        path: "/deviceManagement/configurationPolicies",
        expandable: true,
    },
    Collection {
        kind: "compliancePolicy",
        path: "/deviceManagement/deviceCompliancePolicies",
        expandable: true,
    },
    Collection {
        kind: "deviceConfiguration",
        path: "/deviceManagement/deviceConfigurations",
        expandable: true,
    },
    Collection {
        kind: "groupPolicyConfiguration",
        path: "/deviceManagement/groupPolicyConfigurations",
        expandable: true,
    },
    Collection {
        kind: "mobileApp",
        path: "/deviceAppManagement/mobileApps",
        expandable: true,
    },
    Collection {
        kind: "appProtection",
        path: "/deviceAppManagement/managedAppPolicies",
        expandable: true,
    },
    Collection {
        kind: "script",
        path: "/deviceManagement/deviceManagementScripts",
        expandable: true,
    },
    Collection {
        kind: "script",
        path: "/deviceManagement/deviceHealthScripts",
        expandable: true,
    },
    Collection {
        kind: "autopilotProfile",
        path: "/deviceManagement/windowsAutopilotDeploymentProfiles",
        expandable: true,
    },
    Collection {
        kind: "windowsUpdate",
        path: "/deviceManagement/windowsUpdateProfiles",
        expandable: true,
    },
];

/// Assignments for one object, keyed by the object id the UI already holds.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectAssignments {
    pub id: String,
    pub kind: String,
    pub drafts: Vec<AssignmentDraft>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssignmentSnapshot {
    pub objects: Vec<ObjectAssignments>,
    /// Collections that failed, so the UI can say what is missing.
    pub warnings: Vec<String>,
}

fn rows_of(value: &Value) -> Vec<Value> {
    value
        .get("value")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

/// Read assignment targets for every object in the assignable collections.
pub async fn fetch_assignment_snapshot(
    access_token: &str,
) -> Result<AssignmentSnapshot, GraphError> {
    let client = GraphClient::new();
    let mut objects: Vec<ObjectAssignments> = Vec::new();
    let mut warnings: Vec<String> = Vec::new();

    for collection in COLLECTIONS {
        let path = if collection.expandable {
            format!("{}?$expand=assignments&$top=500", collection.path)
        } else {
            format!("{}?$top=500", collection.path)
        };
        let rows = match client
            .fetch_all_pages::<Value>(access_token, &path, "beta", 500)
            .await
        {
            Ok(rows) => rows,
            Err(error) => {
                warnings.push(format!("{}: {error}", collection.path));
                continue;
            }
        };
        for row in rows {
            let Some(id) = row.get("id").and_then(Value::as_str) else {
                continue;
            };
            let assignments = row
                .get("assignments")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            if assignments.is_empty() {
                continue;
            }
            let drafts = drafts_from_graph_assignments(&assignments, true);
            if drafts.is_empty() {
                continue;
            }
            objects.push(ObjectAssignments {
                id: id.to_string(),
                kind: collection.kind.to_string(),
                drafts,
            });
        }
    }

    Ok(AssignmentSnapshot { objects, warnings })
}

/// Index the snapshot by object id for the simulator's lookup.
pub fn assignments_by_object(
    snapshot: &AssignmentSnapshot,
) -> HashMap<String, Vec<AssignmentDraft>> {
    snapshot
        .objects
        .iter()
        .map(|entry| (entry.id.clone(), entry.drafts.clone()))
        .collect()
}
