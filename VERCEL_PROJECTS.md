# Vercel Projects - Dashboard Setup Guide

## 📊 Current Active Projects

### ✅ **ACTIVE (Use This One)**
**Project:** `honest-pay-dashboard`  
**URL:** https://honest-pay-dashboard.vercel.app  
**Status:** ✓ Up to date with latest code  
**Used By:** bridge-json-vercel.js (UPDATED 11m ago)

**What it includes:**
- ✅ HonestPay branding
- ✅ Real-time polling (1 second)
- ✅ Auto-clear logs on startup
- ✅ Pending NOT counted as failure
- ✅ All recent fixes and improvements

---

### ⚠️ **DEPRECATED (Old Projects - Can Delete)**

**Project 1:** `smartpay-dashboard`  
**URL:** smartpay-dashboard-two.vercel.app  
**Status:** ❌ Old - No longer used by bridge  
**Recommendation:** Delete or archive

**Project 2:** `smart-pay-dashboard`  
**URL:** smart-pay-dashboard.vercel.app  
**Status:** ❌ Old - Not used  
**Recommendation:** Delete or archive

---

## 🔧 Configuration Update

The bridge has been updated to point to the new project:

```javascript
// OLD (deprecated)
const VERCEL_BASE_URL = "https://smartpay-dashboard-two.vercel.app";

// NEW (active)
const VERCEL_BASE_URL = "https://honest-pay-dashboard.vercel.app";
```

---

## 🚀 Next Steps

### 1. **Verify Deployment**
- Go to: https://honest-pay-dashboard.vercel.app
- You should see: **"HonestPay Dashboard - Honest Store Monitor"**
- Hard refresh: `Ctrl+Shift+R` (Windows) or `Cmd+Shift+R` (Mac)

### 2. **Update Your Bridge (if running locally)**
```bash
# Make sure you have latest code:
cd /mnt/d/Users/user/Downloads/SmartPay-Dashboard
git pull

# Restart bridge:
node bridge-json-vercel.js
# It will now send data to: https://honest-pay-dashboard.vercel.app
```

### 3. **Restart Local Dashboard (if running locally)**
```bash
cd /mnt/d/Users/user/Downloads/SmartPay-Dashboard
npm start
# or
node server.js
```

---

## ✅ Final Checklist

- [x] All projects renamed to HonestPay
- [x] Bridge points to honest-pay-dashboard.vercel.app
- [x] Arduino sends "HonestPay Ready"
- [x] Dashboard clears on startup
- [x] Pending NOT counted as failure
- [x] Success rate = failures only (insufficient + invalid)
- [ ] Restart your local server
- [ ] Hard refresh dashboard
- [ ] Test the payment flow

---

## 📝 Branding Summary

| Component | Displays |
|-----------|----------|
| **Dashboard Header** | HonestPay Dashboard - Honest Store Monitor |
| **LCD State Label** | HonestPay Ready |
| **Arduino Output** | HonestPay Ready |
| **Footer** | HonestPay Store Dashboard |
| **Demo Script** | HonestPay Ready |
| **Bridge Output** | HonestPay Ready |

---

## 🎯 Which One to Use?

**Answer:** Use **honest-pay-dashboard.vercel.app**

This is:
- ✅ The newest
- ✅ The most up to date
- ✅ What the bridge sends data to
- ✅ Has all fixes and improvements
- ✅ Fully HonestPay branded

The other two old projects can be deleted from Vercel to reduce clutter.
