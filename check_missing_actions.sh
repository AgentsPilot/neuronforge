#!/bin/bash

# Script to compare plugin definitions with executor implementations

echo "## Plugin Implementation Analysis"
echo ""

check_plugin() {
    local plugin_name=$1
    local executor_name=${2:-$plugin_name}  # Allow override for executor name
    local def_file="lib/plugins/definitions/${plugin_name}-plugin-v2.json"
    local exec_file="lib/server/${executor_name}-plugin-executor.ts"

    # Check if both files exist
    if [[ ! -f "$def_file" ]]; then
        return
    fi

    if [[ ! -f "$exec_file" ]]; then
        echo "### $plugin_name"
        echo "ERROR: Definition exists but NO EXECUTOR FOUND"
        echo ""
        return
    fi

    # Get actions from JSON
    actions=$(jq -r '.actions | keys[]' "$def_file" 2>/dev/null | sort)

    if [[ -z "$actions" ]]; then
        return
    fi

    # Get implemented cases from executor
    implemented=$(grep -oE "case '[a-z_]+'" "$exec_file" | sed "s/case '//g" | sed "s/'//g" | sort | uniq)

    # Find missing actions
    missing=""
    for action in $actions; do
        if ! echo "$implemented" | grep -q "^${action}$"; then
            missing="$missing\n- $action"
        fi
    done

    if [[ -n "$missing" ]]; then
        echo "### $plugin_name"
        echo "**Missing implementations:**"
        echo -e "$missing"
        echo ""
    fi
}

# Check all plugins
check_plugin "google-sheets"
check_plugin "google-mail" "gmail"
check_plugin "google-drive"
check_plugin "google-docs"
check_plugin "google-calendar"
check_plugin "slack"
check_plugin "airtable"
check_plugin "hubspot"
check_plugin "notion"
check_plugin "document-extractor"
check_plugin "onedrive"
check_plugin "outlook"
check_plugin "discord"
check_plugin "salesforce"
check_plugin "meta-ads"
check_plugin "dropbox"
check_plugin "whatsapp"
check_plugin "linkedin"
check_plugin "chatgpt-research"

echo "Analysis complete."
