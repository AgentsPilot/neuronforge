# Footer Plugin UI Fixes ✅

## Issues Fixed

### 1. Icons Disappearing After Connection
**Problem**: When connecting a new plugin (especially Salesforce), some icons in the middle of the footer would disappear.

**Root Cause**:
- The `loadPlugins()` function was fetching from the API immediately after OAuth
- Backend might not have finished updating yet, causing incomplete data
- Empty arrays were replacing the existing plugin list

**Fix Applied**:
1. Added validation to only update if we got valid data:
   ```typescript
   // Only update if we actually got plugins, avoid clearing the list on error
   if (plugins.length > 0 || status.connected.length === 0) {
     setDisplayPlugins(plugins)
   }
   ```

2. Added 500ms delay before reloading to let backend update:
   ```typescript
   await new Promise(resolve => setTimeout(resolve, 500))
   await loadPlugins()
   ```

3. Don't clear existing plugins on error

### 2. Blinking on Hover
**Problem**: When hovering over plugin icons, they would blink/flicker forever.

**Root Cause**:
- Using `hover:scale-110` in className was causing layout shifts
- The scale change would trigger the hover state on/off repeatedly
- CSS class-based hover was conflicting with React state

**Fix Applied**:
Changed from CSS class hover to inline style with React state:

**Before:**
```tsx
className="... hover:scale-110 ..."
style={{
  borderRadius: 'var(--v2-radius-button)',
  boxShadow: 'var(--v2-shadow-card)'
}}
```

**After:**
```tsx
className="... hover:shadow-xl hover:z-10 ..."
style={{
  borderRadius: 'var(--v2-radius-button)',
  boxShadow: 'var(--v2-shadow-card)',
  transform: hoveredPlugin === plugin.plugin_key ? 'scale(1.08)' : 'scale(1)'
}}
```

Benefits:
- ✅ Controlled scale based on React state (no flicker)
- ✅ Smoother animation
- ✅ Added z-index on hover to prevent overlap issues
- ✅ Enhanced shadow on hover for better visual feedback

## Files Modified

- [components/v2/Footer.tsx](components/v2/Footer.tsx:224-245) - Fixed loadPlugins() validation
- [components/v2/Footer.tsx](components/v2/Footer.tsx:263-267) - Added delay before reload
- [components/v2/Footer.tsx](components/v2/Footer.tsx:314-318) - Added delay before reload
- [components/v2/Footer.tsx](components/v2/Footer.tsx:683-697) - Fixed hover scale animation

## Testing

1. ✅ Connect a new plugin (Salesforce, Discord) - icons should stay stable
2. ✅ Hover over plugin icons - smooth scale animation, no blinking
3. ✅ Icons should maintain position during hover
4. ✅ After connection success, all icons should remain visible

## Additional Improvements

While fixing these issues, also made the dialog wider:
- Width: 320px → 650px
- Columns: 3 → 4
- Height: 32rem → 38rem
- Less scrolling needed, better UX
