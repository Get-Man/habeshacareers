# Employer Job Posting System - REVISED Full Requirements

## ✅ Complete System Requirements

### 1. Employer Registration
Before posting, employers must create an account with:
- ✅ Company Name (implemented)
- ✅ Contact Person (implemented)
- ✅ Email (implemented)
- ✅ Phone Number (implemented)
- ✅ Password (implemented)
- ❌ Company Address (full address - needs implementation)
- ❌ Website (optional - needs implementation)
- ❌ Upload Company Logo (optional - needs implementation)

### 2. Job Posting Form

#### A. Job Basic Information
- ✅ Job Title (implemented)
- ✅ Number of Vacancies (implemented)
- ✅ Job Category / Sector (14 categories implemented)
- ✅ Job Type (Full-Time, Part-Time, Contract - implemented)
- ❌ Remote option (needs to be added)
- ❌ Internship option (needs to be added)
- ✅ Work Location (City, Region, Country - implemented)
- ❌ Salary Range (optional - needs implementation)
- ✅ Application Deadline (implemented)

#### B. Job Description Sections
**Must be organized as separate sections:**
1. ❌ **Roles & Responsibilities** (Bullet-point duties)
2. ❌ **Qualifications** (Education, experience, skills)
3. ❌ **Required Skills / Competencies** (Technical + soft skills)
4. ❌ **Job Summary** (Optional short overview)

**Current:** Single "Job Description" and "Requirements" fields
**Needed:** Restructure into 4 distinct sections

#### C. Company Information
- ✅ Company Name (auto-filled from registration)
- ❌ Company Profile / Description (needs implementation)
- ❌ Company Website (optional - needs implementation)
- ❌ Company Logo display (needs implementation)

#### D. Application Instructions
- ✅ Application Email (implemented)
- ❌ Application Website option (needs implementation)
- ❌ Additional Instructions field (e.g., "Attach CV only in PDF")

### 3. 🆕 Recruitment Process Question

**CRITICAL NEW FEATURE**

After job details, employer must select recruitment handler:

**Question:** "Who will manage the recruitment process?"

**Option A:** ✔ My organization will handle recruitment
- Employer receives applications directly
- Habesha Career provides only job posting service
- No involvement in screening
- Standard posting fee only

**Option B:** ✔ Habesha Career will manage the entire recruitment process
- Habesha Career collects applications
- Habesha Career shortlists candidates
- Habesha Career communicates with applicants
- Habesha Career submits final candidates to employer
- **Additional service fee applies**

**Implementation:**
- Radio button selection (required field)
- Affects pricing on payment page
- Determines dashboard features
- Stored in job data

### 4. Payment Page

**After form completion, redirect to payment page showing:**

#### Payment Breakdown:
- **Job Posting Fee:** 500 ETB (base price)
- **Featured Job Fee:** +200 ETB (optional checkbox)
- **Recruitment Management Fee:** +1,000 ETB (if Option B selected)
- **Total Amount:** [Calculated sum]

#### Payment Methods:
**Online Payments:**
- Chapa (All Ethiopian banks + mobile money)
- PayPal (International)
- Stripe (International)

**Local Payments:**
- Telebirr
- CBE Birr
- HelloCash
- M-Birr
- Bank Transfer (manual verification)

#### Payment Page Features:
- Generate Invoice / Payment Reference
- Payment instructions
- Secure payment gateway integration
- Payment confirmation email

### 5. 🔐 Approval Logic & Visibility Rules

#### ✔ If Employer PAYS:
- ✅ Job is **automatically approved**
- ✅ Job becomes **publicly visible** on website
- ✅ Employer receives **confirmation email**
- ✅ Dashboard shows: **"Active Job Post"**
- ✅ Job appears in search results
- ✅ Job seekers can apply

#### ✖ If Employer DOES NOT PAY:
- ❌ Job saved as **"Draft / Pending Payment"**
- ❌ Job is **NOT visible** to job seekers
- ❌ Job does NOT appear in search
- ⚠️ Employer sees message: **"Your job post is submitted but not visible until payment is received."**
- 📧 Reminder email sent after 24 hours
- 🗑️ Auto-delete after 7 days if unpaid

### 6. Employer Dashboard Features

**Employers can:**
- ✅ View all job postings (Active, Pending, Expired)
- ✅ Check status with color indicators
- ✅ Make payment for pending posts
- ✅ Edit job posting (before approval)
- ✅ Upgrade to featured listing
- ✅ View applicants (if recruitment handled by organization)
- ✅ View shortlisted candidates (if handled by Habesha Career)
- ✅ View invoices / receipts
- ✅ Download applicant CVs
- ✅ Mark position as filled
- ✅ Renew expired jobs
- ✅ View job analytics (views, applications)

### 7. Admin Dashboard (Platform Management)

**Admin can:**
- ✅ Approve / Reject job posts (manual override)
- ✅ Review payment status
- ✅ Track all employers
- ✅ Manage featured positions
- ✅ Handle recruitment assignments
- ✅ Manage candidate submissions
- ✅ Generate reports (revenue, jobs, applications)
- ✅ View analytics dashboard
- ✅ Manage refunds
- ✅ Send notifications to employers
- ✅ Moderate job content

### 8. 🎯 Navigation Rule: Post Job Button

**IMPORTANT:** "Post Job" button visibility logic:

**When Job Seeker logs in:**
- ❌ Hide "Post Job" button from navbar
- ✅ Show "Profile" icon instead

**When Employer logs in:**
- ✅ Show "Post Job" button in navbar
- ✅ Show employer dashboard access

**When NOT logged in:**
- ✅ Show "Post Job" button
- ➡️ Clicking redirects to login page
- ➡️ After login, check user type and redirect accordingly

---

## Current Implementation Status

### ✅ Already Implemented

#### 1. Employer Registration / Login
**Location:** `login.html`
- ✅ Company Name
- ✅ Contact Person Name
- ✅ Email
- ✅ Phone Number
- ✅ Location (City selection)
- ✅ Password / Confirm Password
- ✅ Gmail validation
- ✅ Separate employer/job seeker authentication

**Missing:**
- ❌ Company Address (full address)
- ❌ Company Website field
- ❌ Logo Upload
- ❌ Social login (Google, LinkedIn)
- ❌ Email/Phone verification

#### 2. Job Posting Form
**Location:** `post-job.html`
- ✅ Job Title
- ✅ Company/Organization Name
- ✅ Job Category (14 categories)
- ✅ Job Type (Full-time, Part-time, Contract)
- ✅ Location
- ✅ Number of Vacancies
- ✅ Job Description
- ✅ Requirements
- ✅ Application Deadline
- ✅ Contact Email

**Missing:**
- ❌ Salary Range field
- ❌ Remote work option
- ❌ Application phone number
- ❌ Website/portal link
- ❌ Featured job option
- ❌ Company logo upload for job

#### 3. Payment Integration
**Status:** ❌ NOT IMPLEMENTED
**Required:** Full payment system before job posting

#### 4. Job Approval / Moderation
**Status:** ❌ NOT IMPLEMENTED
**Current:** Jobs go live immediately after posting

#### 5. Employer Dashboard
**Status:** ❌ NOT IMPLEMENTED
**Needed:** Dedicated employer dashboard page

#### 6. Applicant Interaction
**Status:** ✅ PARTIALLY IMPLEMENTED
- ✅ Email application link
- ❌ Direct CV upload to platform
- ❌ Application tracking

---

## Implementation Roadmap

### Phase 1: Enhanced Employer Registration (Week 1)
**Priority:** HIGH

**Tasks:**
1. Add company address field to registration
2. Add company website field
3. Implement logo upload functionality
4. Add email verification system
5. Store additional employer data in localStorage

**Files to Update:**
- `login.html` - Add new fields
- `js/auth.js` - Update registration logic
- Create `js/email-verification.js`

---

### Phase 2: Enhanced Job Posting Form (Week 1-2)
**Priority:** HIGH

**Tasks:**
1. Add salary range fields (min/max)
2. Add remote work checkbox
3. Add application phone number field
4. Add website/portal link field
5. Add featured job option (checkbox)
6. Add company logo upload for job listing
7. Improve form validation

**Files to Update:**
- `post-job.html` - Add new fields
- `js/post-job.js` - Update form handling
- `css/style.css` - Style new fields

---

### Phase 3: Payment Integration (Week 2-3)
**Priority:** CRITICAL

#### Payment Models to Implement:

**A. Pay-Per-Post**
- Single job post: 500 ETB
- Payment required before job goes live

**B. Subscription Packages**
- 3 job posts: 1,200 ETB (save 300 ETB)
- 5 job posts: 1,800 ETB (save 700 ETB)
- 10 job posts: 3,000 ETB (save 2,000 ETB)
- Monthly unlimited: 5,000 ETB

**C. Featured Listing**
- Additional 200 ETB per job
- Highlighted in search results
- Appears at top of listings

#### Payment Gateways for Ethiopia:

**1. Chapa (Recommended)**
- Website: https://chapa.co
- Supports: All major Ethiopian banks
- Mobile money: Telebirr, CBE Birr, M-Birr
- Easy API integration
- Local support

**2. YenePay**
- Website: https://yenepay.com
- Ethiopian payment gateway
- Bank and mobile money support
- Merchant dashboard

**3. Manual Bank Transfer**
- Commercial Bank of Ethiopia (CBE)
- Awash International Bank
- Dashen Bank
- Manual verification by admin

**Implementation Steps:**
1. Create payment selection page
2. Integrate Chapa API
3. Create payment confirmation system
4. Implement webhook handlers
5. Generate payment receipts
6. Link payment to job posting

**Files to Create:**
- `payment.html` - Payment selection page
- `js/payment.js` - Payment logic
- `js/payment-webhook.js` - Webhook handler
- `css/payment.css` - Payment styling

---

### Phase 4: Job Approval System (Week 3-4)
**Priority:** MEDIUM

**Admin Features:**
1. Admin login system
2. Pending jobs queue
3. Approve/Reject functionality
4. Rejection reason field
5. Email notifications to employers
6. Scheduled posting date

**Job Statuses:**
- `pending` - Awaiting payment
- `paid` - Payment confirmed, awaiting approval
- `approved` - Live on website
- `rejected` - Not approved (with reason)
- `expired` - Past deadline
- `closed` - Manually closed by employer

**Files to Create:**
- `admin-dashboard.html` - Admin panel
- `admin-jobs.html` - Job moderation page
- `js/admin.js` - Admin functionality
- `css/admin.css` - Admin styling

---

### Phase 5: Employer Dashboard (Week 4-5)
**Priority:** HIGH

**Dashboard Features:**

**A. Overview Section**
- Total jobs posted
- Active jobs count
- Total applications received
- Account balance / credits

**B. My Jobs Section**
- List all posted jobs
- Filter: Active, Expired, Pending, Rejected
- Sort: Newest, Most viewed, Most applied
- Quick actions: Edit, Delete, Renew, Close

**C. Job Management**
- Edit job details
- Extend deadline
- Mark position as filled
- Repost expired jobs
- Duplicate job posting

**D. Analytics**
- Job views count
- Application count per job
- View trends (graph)
- Best performing jobs

**E. Applicants Section**
- View applicants per job
- Download CVs
- Filter applicants
- Mark as reviewed/shortlisted

**F. Billing & Payments**
- Payment history
- Invoices/Receipts
- Purchase credits/packages
- Subscription management

**G. Company Profile**
- Edit company information
- Update logo
- Manage contact details

**Files to Create:**
- `employer-dashboard.html` - Main dashboard
- `employer-jobs.html` - Job management
- `employer-applicants.html` - Applicant management
- `employer-billing.html` - Payment history
- `employer-profile.html` - Company profile
- `js/employer-dashboard.js` - Dashboard logic
- `css/employer-dashboard.css` - Dashboard styling

---

### Phase 6: Enhanced Applicant System (Week 5-6)
**Priority:** MEDIUM

**Features:**
1. Direct CV upload to platform
2. Application form with cover letter
3. Application tracking for job seekers
4. Email notifications
5. Application status updates

**Application Statuses:**
- `submitted` - Application received
- `reviewed` - Employer viewed
- `shortlisted` - Selected for interview
- `rejected` - Not selected
- `hired` - Position filled

**Files to Update:**
- `job-details.html` - Add apply form
- `js/job-details.js` - Application logic
- Create `js/applications.js`
- Update `profile.html` - Application tracking

---

### Phase 7: Legal & Policies (Week 6)
**Priority:** MEDIUM

**Documents to Create:**
1. Terms & Conditions for employers
2. Privacy Policy
3. Payment Policy
4. Refund Policy
5. Job Posting Guidelines
6. User Agreement

**Files to Create:**
- `terms.html` - Terms & Conditions
- `privacy.html` - Privacy Policy
- `payment-policy.html` - Payment terms
- `refund-policy.html` - Refund policy

---

### Phase 8: Optional Add-ons (Week 7-8)
**Priority:** LOW

**A. Social Media Integration**
- Auto-post jobs to Facebook
- Share to LinkedIn
- Tweet new jobs
- WhatsApp sharing

**B. Email Marketing**
- Newsletter for new jobs
- Job alerts for seekers
- Employer notifications

**C. Advanced Analytics**
- Detailed job performance
- Competitor analysis
- Market insights
- Salary benchmarking

**D. Mobile App**
- Android app
- iOS app
- Push notifications

---

## Database Schema (For Backend Implementation)

### Employers Table
```sql
CREATE TABLE employers (
    id INT PRIMARY KEY AUTO_INCREMENT,
    company_name VARCHAR(255) NOT NULL,
    contact_person VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(20),
    address TEXT,
    city VARCHAR(100),
    country VARCHAR(100),
    website VARCHAR(255),
    logo VARCHAR(255),
    password_hash VARCHAR(255) NOT NULL,
    email_verified BOOLEAN DEFAULT FALSE,
    verification_token VARCHAR(255),
    credits INT DEFAULT 0,
    subscription_type VARCHAR(50),
    subscription_expires DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

### Jobs Table
```sql
CREATE TABLE jobs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    employer_id INT NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    requirements TEXT,
    category VARCHAR(100),
    job_type VARCHAR(50),
    location VARCHAR(255),
    salary_min DECIMAL(10,2),
    salary_max DECIMAL(10,2),
    vacancies INT DEFAULT 1,
    deadline DATE,
    contact_email VARCHAR(255),
    contact_phone VARCHAR(20),
    application_url VARCHAR(255),
    is_remote BOOLEAN DEFAULT FALSE,
    is_featured BOOLEAN DEFAULT FALSE,
    status VARCHAR(50) DEFAULT 'pending',
    rejection_reason TEXT,
    views INT DEFAULT 0,
    applications_count INT DEFAULT 0,
    posted_date TIMESTAMP,
    approved_date TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (employer_id) REFERENCES employers(id)
);
```

### Payments Table
```sql
CREATE TABLE payments (
    id INT PRIMARY KEY AUTO_INCREMENT,
    employer_id INT NOT NULL,
    job_id INT,
    amount DECIMAL(10,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'ETB',
    payment_method VARCHAR(50),
    payment_provider VARCHAR(50),
    transaction_id VARCHAR(255) UNIQUE,
    package_type VARCHAR(50),
    credits_purchased INT,
    status VARCHAR(50) DEFAULT 'pending',
    paid_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (employer_id) REFERENCES employers(id),
    FOREIGN KEY (job_id) REFERENCES jobs(id)
);
```

### Applications Table
```sql
CREATE TABLE applications (
    id INT PRIMARY KEY AUTO_INCREMENT,
    job_id INT NOT NULL,
    job_seeker_id INT NOT NULL,
    cover_letter TEXT,
    cv_file VARCHAR(255),
    status VARCHAR(50) DEFAULT 'submitted',
    notes TEXT,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TIMESTAMP,
    FOREIGN KEY (job_id) REFERENCES jobs(id),
    FOREIGN KEY (job_seeker_id) REFERENCES job_seekers(id)
);
```

---

## API Endpoints Needed

### Authentication
- `POST /api/auth/employer/register` - Register employer
- `POST /api/auth/employer/login` - Login employer
- `POST /api/auth/employer/verify-email` - Verify email
- `POST /api/auth/employer/forgot-password` - Reset password

### Jobs
- `POST /api/jobs` - Create job (requires payment)
- `GET /api/jobs` - List all jobs
- `GET /api/jobs/:id` - Get job details
- `PUT /api/jobs/:id` - Update job
- `DELETE /api/jobs/:id` - Delete job
- `POST /api/jobs/:id/renew` - Renew expired job

### Payments
- `POST /api/payments/initiate` - Start payment
- `POST /api/payments/verify` - Verify payment
- `POST /api/payments/webhook` - Payment webhook
- `GET /api/payments/history` - Payment history

### Employer Dashboard
- `GET /api/employer/dashboard` - Dashboard stats
- `GET /api/employer/jobs` - Employer's jobs
- `GET /api/employer/applicants/:jobId` - Job applicants
- `GET /api/employer/analytics/:jobId` - Job analytics

### Admin
- `GET /api/admin/jobs/pending` - Pending jobs
- `POST /api/admin/jobs/:id/approve` - Approve job
- `POST /api/admin/jobs/:id/reject` - Reject job

---

## Cost Estimates

### Development Costs
- Backend Development: 2-3 months
- Payment Integration: 2-3 weeks
- Admin Panel: 2-3 weeks
- Employer Dashboard: 3-4 weeks
- Testing & QA: 2-4 weeks

### Operational Costs
- **Payment Gateway Fees:** 2-3% per transaction
- **Hosting:** $50-200/month (AWS, DigitalOcean)
- **SSL Certificate:** $50-100/year
- **Email Service:** $10-50/month (SendGrid, AWS SES)
- **SMS Service:** $20-100/month (for verification)
- **Domain:** $10-20/year
- **Backup Storage:** $10-30/month

### Revenue Model
- **Pay-per-post:** 500 ETB/job
- **Packages:** 1,200-5,000 ETB
- **Featured listings:** +200 ETB
- **Monthly target:** 50 jobs = 25,000 ETB minimum

---

## Next Steps

### Immediate Actions (This Week):
1. ✅ Review current implementation
2. ⏳ Enhance employer registration form
3. ⏳ Add missing fields to job posting
4. ⏳ Research payment gateway options
5. ⏳ Design employer dashboard mockup

### Short Term (Next 2 Weeks):
1. Implement payment integration
2. Create employer dashboard
3. Add job approval system
4. Set up email notifications

### Medium Term (Next Month):
1. Build admin panel
2. Enhance applicant system
3. Add analytics
4. Create legal documents

### Long Term (Next 3 Months):
1. Mobile app development
2. Advanced features
3. Marketing integration
4. Scale infrastructure

---

## Success Metrics

### Key Performance Indicators (KPIs):
- Number of registered employers
- Jobs posted per month
- Payment conversion rate
- Average revenue per employer
- Job seeker engagement
- Application completion rate
- Employer retention rate

### Target Goals (6 Months):
- 100+ registered employers
- 200+ active job listings
- 1,000+ registered job seekers
- 500+ applications per month
- 50,000+ ETB monthly revenue

---

**Status:** Ready for Implementation  
**Priority:** HIGH  
**Complexity:** HIGH  
**Timeline:** 3-4 months for full implementation

**Last Updated:** November 24, 2025
