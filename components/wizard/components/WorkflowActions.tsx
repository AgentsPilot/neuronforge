import React from 'react';
import { 
  CheckCircle, 
  Edit3, 
  RefreshCw,
  Save,
  X,
  AlertTriangle 
} from 'lucide-react';
import type { GeneratedPlan } from '../workflowAnalysis';

interface WorkflowActionsProps {
  generatedPlan: GeneratedPlan;
  isEditing: boolean;
  viewMode: 'business' | 'technical';
  currentMissingPlugins: string[];
  currentUnconnectedPlugins: string[];
  onEditCancel: () => void;
  onEditSave: () => void;
  onToggleEdit: () => void;
  onRegeneratePlan: () => void;
  onAcceptPlan: () => void;
}

export function WorkflowActions({
  generatedPlan,
  isEditing,
  viewMode,
  currentMissingPlugins,
  currentUnconnectedPlugins,
  onEditCancel,
  onEditSave,
  onToggleEdit,
  onRegeneratePlan,
  onAcceptPlan
}: WorkflowActionsProps) {
  const hasEditingAccess = isEditing && viewMode === 'technical';
  const hasMissingPlugins = currentMissingPlugins.length > 0;
  const hasUnconnectedPlugins = currentUnconnectedPlugins.length > 0;
  
  // Determine if plan can be accepted
  const canAcceptPlan = !isEditing && !hasMissingPlugins;
  
  // Determine disabled reason for accept button
  let acceptButtonDisabledReason = null;
  if (isEditing) {
    acceptButtonDisabledReason = 'Save your changes first before accepting the plan';
  } else if (hasMissingPlugins) {
    acceptButtonDisabledReason = `Missing plugins: ${currentMissingPlugins.join(', ')}`;
  }

  return (
    <div className="pt-6 border-t border-gray-200">
      {/* Secondary Action Buttons */}
      <div className="grid grid-cols-4 gap-4">
        <button 
          onClick={onEditCancel} 
          className={`flex items-center justify-center gap-2 px-4 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-medium ${
            !hasEditingAccess ? 'opacity-50 cursor-not-allowed' : ''
          }`}
          disabled={!hasEditingAccess}
          title={!hasEditingAccess ? 'Only available in edit mode' : 'Cancel editing and discard changes'}
        >
          <X className="h-4 w-4" />
          Cancel
        </button>
        
        <button 
          onClick={onEditSave} 
          className={`flex items-center justify-center gap-2 px-4 py-3 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors font-medium ${
            !hasEditingAccess ? 'opacity-50 cursor-not-allowed' : ''
          }`}
          disabled={!hasEditingAccess}
          title={!hasEditingAccess ? 'Only available in edit mode' : 'Save your changes to the workflow'}
        >
          <Save className="h-4 w-4" />
          Save Changes
        </button>
        
        <button 
          onClick={onToggleEdit} 
          className={`flex items-center justify-center gap-2 px-4 py-3 border border-blue-300 text-blue-600 rounded-lg hover:bg-blue-50 transition-colors font-medium ${
            viewMode !== 'technical' ? 'opacity-50 cursor-not-allowed' : ''
          }`}
          disabled={viewMode !== 'technical'}
          title={viewMode !== 'technical' ? 'Switch to Technical View to edit' : (isEditing ? 'Exit edit mode' : 'Enter edit mode')}
        >
          <Edit3 className="h-4 w-4" />
          {isEditing ? 'Exit Edit Mode' : 'Edit Workflow'}
        </button>
        
        <button 
          onClick={onRegeneratePlan} 
          className="flex items-center justify-center gap-2 px-4 py-3 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors font-medium"
          title="Generate a new AI plan from scratch"
        >
          <RefreshCw className="h-4 w-4" />
          Regenerate Plan
        </button>
      </div>

      {/* Status Messages */}
      {(isEditing || hasMissingPlugins || hasUnconnectedPlugins) && (
        <div className="mt-4 space-y-2">
          {isEditing && (
            <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0" />
              <div className="text-sm">
                <span className="font-medium text-amber-800">Editing Mode Active</span>
                <span className="text-amber-700 ml-2">Save your changes before accepting the plan</span>
              </div>
            </div>
          )}
          
          {hasMissingPlugins && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
              <AlertTriangle className="h-4 w-4 text-red-600 flex-shrink-0" />
              <div className="text-sm">
                <span className="font-medium text-red-800">Missing Plugins</span>
                <span className="text-red-700 ml-2">{currentMissingPlugins.join(', ')} - these plugins are not available</span>
              </div>
            </div>
          )}
          
          {hasUnconnectedPlugins && !hasMissingPlugins && (
            <div className="flex items-center gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
              <AlertTriangle className="h-4 w-4 text-yellow-600 flex-shrink-0" />
              <div className="text-sm">
                <span className="font-medium text-yellow-800">Plugins Need Connection</span>
                <span className="text-yellow-700 ml-2">{currentUnconnectedPlugins.join(', ')} - connect these plugins to use them</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Primary Action Button */}
      <div className="flex justify-center mt-6">
        <button
          onClick={onAcceptPlan}
          disabled={!canAcceptPlan}
          className={`flex items-center gap-3 px-8 py-4 rounded-xl font-semibold text-lg shadow-lg transition-all ${
            canAcceptPlan 
              ? 'bg-gradient-to-r from-emerald-600 to-blue-600 text-white hover:from-emerald-700 hover:to-blue-700 hover:shadow-xl'
              : 'bg-gray-300 text-gray-500 cursor-not-allowed opacity-60'
          }`}
          title={acceptButtonDisabledReason || 'Accept and save this AI-generated workflow'}
        >
          <CheckCircle className="h-6 w-6" />
          Accept AI Plan
          {hasUnconnectedPlugins && canAcceptPlan && (
            <span className="text-sm bg-white/20 px-3 py-1 rounded-full ml-2">
              Needs Connection
            </span>
          )}
        </button>
      </div>
      
      {/* Help Text */}
      <div className="text-center mt-3 text-sm text-gray-500">
        {isEditing 
          ? 'Save your changes first, then accept the plan to continue'
          : hasMissingPlugins 
          ? 'Fix missing plugins to proceed'
          : 'Accept this plan to proceed to execution settings'
        }
      </div>
    </div>
  );
}