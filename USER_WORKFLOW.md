# Habesha Career - User Workflow & Payment Integration

## Complete User Workflow Implementation Plan

---

## 1. JOB SEEKER WORKFLOW

### A. After Login - Profile Creation
Job seekers will be redirected to create/edit their profile:

**Profile Sections:**

1. **Personal Information**
   - Full Name
   - Email (auto-filled from registration)
   - Phone Number
   - Location (City/Region)
   - Date of Birth
   - Gender
   - Profile Photo (optional)

2. **Education**
   - Institution Name
   - Degree/Certificate
   - Field of Study
   - Start Date - End Date
   - Grade/GPA (optional)
   - Add multiple education entries

3. **Work Experience**
   - Company Name
   - Job Title
   - Employment Type
   - Start Date - End Date (or "Currently Working")
   - Job Description
   - Add multiple work experiences

4. **Skills & Certifications**
   - Skills (tags/chips)
   - Certifications (Name, Issuing Organization, Date)
   - Languages (Language, Proficiency Level)

5. **Resume/CV Upload**
   - Upload PDF, DOC, DOCX (max 5MB)
   - Optional but recommended
   - Can update anytime

**Profile Features:**
- ✅ Editable anytime
- ✅ Profile completion percentage
- ✅ Public profile view for employers
- ✅ Privacy settings

---

## 2. EMPLOYER WORKFLOW

### A. After Login - Job Posting Options

Employers have TWO methods to post jobs:

#### Option 1: Manual Entry (Narration/Text Input)
- Fill out the existing job posting form
- All fields as currently implemented
- Preview before submission

#### Option 2: File Upload
- Upload job description files
- Supported formats:
  - PDF (.pdf)
  - Microsoft Word (.doc, .docx)
  - Microsoft Excel (.xls, .xlsx)
- System extracts key information
- Employer reviews and confirms details

### B. Subscription & Payment

**Payment Requirement:**
- ⚠️ **Mandatory payment** for ALL job postings
- Payment required BEFORE job goes live
- No free trial or free posts

**Pricing Structure (Example):**
- Single Job Post: 500 ETB
- 3 Job Posts Package: 1,200 ETB (save 300 ETB)
- 5 Job Posts Package: 1,800 ETB (save 700 ETB)
- Monthly Unlimited: 3,000 ETB

---

## 3. PAYMENT INTEGRATION

### A. Ethiopian Banks

**Supported Banks:**
1. Commercial Bank of Ethiopia (CBE)
2. Awash International Bank
3. Abyssinia Bank
4. Abay Bank
5. Bank of Amhara
6. Dashen Bank
7. Wegagen Bank
8. Nib International Bank
9. Cooperative Bank of Oromia
10. Lion International Bank
11. Oromia International Bank
12. Berhan International Bank
13. Zemen Bank

**Bank Payment Methods:**
- Direct bank transfer
- Online banking portal
- SWIFT transfer (international)
- QR code payment

### B. Mobile Money / Digital Wallets

**Supported Mobile Payment:**
1. **Telebirr** (Ethio Telecom)
2. **HelloCash**
3. **M-Birr**
4. **CBE Birr** (Commercial Bank of Ethiopia)
5. **Amole** (Awash Bank)

**Mobile Payment Features:**
- USSD codes
- Mobile app integration
- QR code scanning
- SMS confirmation

### C. Payment Gateway Integration

**Recommended Payment Gateways for Ethiopia:**
1. **Chapa** (https://chapa.co)
   - Supports all major Ethiopian banks
   - Mobile money integration
   - Easy API integration
   - Local support

2. **YenePay** (https://yenepay.com)
   - Ethiopian payment gateway
   - Bank and mobile money support
   - Merchant dashboard

3. **Santim Pay**
   - Local payment processor
   - Multiple payment methods

---

## 4. POST-PAYMENT WORKFLOW

### A. Payment Confirmation
1. User completes payment
2. Payment gateway sends webhook
3. System verifies payment
4. Job posting status: "Pending" → "Active"
5. Email confirmation sent to employer

### B. Job Goes Live
- Job appears on website immediately
- Searchable and filterable
- Visible to all job seekers
- Employer receives confirmation email

### C. Employer Dashboard
- View all posted jobs
- Track application count
- Edit job details (if needed)
- Extend deadline
- Mark position as filled
- View applicant profiles

### D. Job Seeker Application
- Apply with profile
- Upload additional documents
- Write cover letter
- Track application status

---

## 5. IMPLEMENTATION PHASES

### Phase 1: User Profiles (Week 1-2)
- [ ] Create job seeker profile pages
- [ ] Build profile edit functionality
- [ ] Implement resume upload
- [ ] Add profile completion tracker

### Phase 2: Enhanced Job Posting (Week 3)
- [ ] Add file upload option for employers
- [ ] Build file parser (PDF, Word, Excel)
- [ ] Create job preview page
- [ ] Add draft saving feature

### Phase 3: Payment Integration (Week 4-5)
- [ ] Integrate Chapa/YenePay API
- [ ] Create payment selection page
- [ ] Build payment confirmation system
- [ ] Implement webhook handlers
- [ ] Add payment receipt generation

### Phase 4: Dashboard & Management (Week 6)
- [ ] Build employer dashboard
- [ ] Create job seeker dashboard
- [ ] Add application tracking
- [ ] Implement notification system

### Phase 5: Testing & Launch (Week 7-8)
- [ ] Test all payment methods
- [ ] Security audit
- [ ] Performance optimization
- [ ] User acceptance testing
- [ ] Production deployment

---

## 6. DATABASE SCHEMA ADDITIONS

### Job Seeker Profile Table
```sql
CREATE TABLE job_seeker_profiles (
    id INT PRIMARY KEY,
    user_id INT,
    full_name VARCHAR(255),
    phone VARCHAR(20),
    location VARCHAR(100),
    date_of_birth DATE,
    gender VARCHAR(20),
    profile_photo VARCHAR(255),
    resume_file VARCHAR(255),
    skills TEXT,
    bio TEXT,
    profile_completion INT,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);
```

### Education Table
```sql
CREATE TABLE education (
    id INT PRIMARY KEY,
    profile_id INT,
    institution VARCHAR(255),
    degree VARCHAR(100),
    field_of_study VARCHAR(100),
    start_date DATE,
    end_date DATE,
    grade VARCHAR(50)
);
```

### Work Experience Table
```sql
CREATE TABLE work_experience (
    id INT PRIMARY KEY,
    profile_id INT,
    company VARCHAR(255),
    job_title VARCHAR(100),
    employment_type VARCHAR(50),
    start_date DATE,
    end_date DATE,
    is_current BOOLEAN,
    description TEXT
);
```

### Payments Table
```sql
CREATE TABLE payments (
    id INT PRIMARY KEY,
    employer_id INT,
    job_id INT,
    amount DECIMAL(10,2),
    currency VARCHAR(3),
    payment_method VARCHAR(50),
    payment_provider VARCHAR(50),
    transaction_id VARCHAR(255),
    status VARCHAR(20),
    paid_at TIMESTAMP,
    created_at TIMESTAMP
);
```

### Job Applications Table
```sql
CREATE TABLE job_applications (
    id INT PRIMARY KEY,
    job_id INT,
    job_seeker_id INT,
    cover_letter TEXT,
    resume_file VARCHAR(255),
    status VARCHAR(50),
    applied_at TIMESTAMP
);
```

---

## 7. API ENDPOINTS NEEDED

### Job Seeker APIs
- POST /api/profile/create
- PUT /api/profile/update
- GET /api/profile/:id
- POST /api/profile/upload-resume
- POST /api/jobs/:id/apply

### Employer APIs
- POST /api/jobs/create
- POST /api/jobs/upload-file
- GET /api/employer/dashboard
- GET /api/employer/jobs
- PUT /api/jobs/:id/update

### Payment APIs
- POST /api/payment/initiate
- POST /api/payment/verify
- POST /api/payment/webhook
- GET /api/payment/receipt/:id

---

## 8. SECURITY CONSIDERATIONS

- ✅ Secure file upload validation
- ✅ Payment data encryption
- ✅ PCI compliance for card payments
- ✅ HTTPS/SSL certificate required
- ✅ Input sanitization
- ✅ Rate limiting on API endpoints
- ✅ Secure webhook verification
- ✅ User data privacy (GDPR-like)

---

## 9. NEXT STEPS

1. **Choose Payment Gateway**: Recommend Chapa for Ethiopian market
2. **Backend Development**: Build Node.js/Python backend
3. **Database Setup**: PostgreSQL or MySQL
4. **File Storage**: AWS S3 or local storage
5. **Email Service**: SendGrid or AWS SES
6. **Testing Environment**: Sandbox payment testing

---

## 10. ESTIMATED COSTS

**Development:**
- Backend Development: 2-3 months
- Payment Integration: 2-3 weeks
- Testing & QA: 2-4 weeks

**Operational:**
- Payment Gateway Fees: 2-3% per transaction
- Hosting: $50-200/month
- SSL Certificate: $50-100/year
- Email Service: $10-50/month
- File Storage: $20-100/month

---

**Status:** Ready for Implementation
**Priority:** High
**Complexity:** Medium-High
