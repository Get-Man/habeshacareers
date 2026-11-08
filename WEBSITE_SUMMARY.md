# Habesha Career Website - Complete Summary

## 🎯 Website Overview
**Name:** Habesha Career  
**Purpose:** Job and career opportunity platform for Ethiopia and the Horn of Africa  
**Target Users:** Job seekers, Employers, Students, Fresh graduates, NGOs

---

## 📄 Pages Structure

### 1. **Home Page (index.html)**
- **Hero Section:**
  - Heading: "Find Your Dream Career in Ethiopia"
  - Subheading: "Connecting talent with opportunities across the Horn of Africa"
  - Search bar for job search
  - Hero image (professional recruitment theme)
  
- **Browse by Category Section:**
  - 6 categories displayed horizontally:
    - 💻 IT & Technology
    - 🏥 Health
    - 🌍 NGO & Development
    - ⚙️ Engineering
    - 📚 Education
    - 💰 Finance
  - Each category shows total number of vacancies
  
- **Recently Posted Jobs:**
  - Displays last 6 jobs
  - Shows: Job title, Company, Location, Job type, Category, Deadline
  - "View All Jobs" button

### 2. **Jobs Listing Page (jobs.html)**
- **Filters Sidebar:**
  - Category filter
  - Location filter (Addis Ababa, Dire Dawa, Mekelle, Bahir Dar, Hawassa)
  - Job Type filter (Full-time, Part-time, Contract)
  - Sort by (Newest First, Deadline Soon)
  
- **Job Cards Display:**
  - Shows all available jobs
  - Each card includes: Title, Company, Location, Type, Category, Vacancies, Days left, Posted date
  - Click to view full details

### 3. **Job Details Page (job-details.html)**
- Full job information:
  - Job title and company
  - Location, Job type, Category
  - Number of vacancies
  - Posted date and deadline
  - Deadline warning (if < 7 days)
  - Full job description
  - Requirements
  - How to apply (email)
  - "Apply Now" button (opens email)

### 4. **Post Job Page (post-job.html)**
- **Employer Only** (requires login as employer)
- Form fields:
  - Job Title
  - Company/Organization
  - Category (dropdown)
  - Job Type (dropdown)
  - Location
  - Number of Vacancies
  - Job Description
  - Requirements
  - Application Deadline
  - Contact Email
- Submit and Clear buttons
- Success confirmation message

### 5. **About Page (about.html)**
- **Our Mission:** Connecting talented professionals with meaningful career opportunities
- **Our Vision:** Become the leading job platform in Ethiopia
- **Our Values:**
  - Accessibility
  - Integrity
  - Excellence
  - Community
- **Who We Serve:**
  - Job Seekers
  - Employers
  - Students
- **Our Platform:** Description of services

### 6. **Contact Page (contact.html)**
- Contact form:
  - Name
  - Email
  - Subject
  - Message
- Contact information:
  - Email: info@habeshacareer.com
  - Location: Addis Ababa, Ethiopia
  - Business Hours: Mon-Fri 9AM-5PM, Sat 10AM-2PM
- Social media links (Facebook, LinkedIn, Twitter)

### 7. **Login Page (login.html)**
- Single unified login form
- Fields:
  - Email
  - Password
  - User Type (Job Seeker or Employer dropdown)
- Demo accounts displayed:
  - Job Seeker: jobseeker@test.com / password123
  - Employer: employer@test.com / password123

---

## 🎨 Design Features

### Color Scheme
- **Primary Green:** #009A44 (Ethiopian flag)
- **Red:** #DA1A32 (Ethiopian flag)
- **Yellow:** #FDB913 (Ethiopian flag)
- **Navbar:** #224f55 (Dark teal with glassmorphism)
- **Dark Text:** #2c3e50
- **Light Gray:** #f4f4f4
- **White:** #ffffff

### Navigation Bar
- **Style:** Glassmorphism (frosted glass effect)
- **Color:** Dark teal (#224f55) with transparency
- **Features:**
  - Logo with white background
  - White text with glass card effect on links
  - Hover animations (lift effect)
  - Sticky positioning
  - Responsive hamburger menu for mobile

### Hero Section
- **Background:** Green to Yellow gradient
- **Layout:** Two columns (text + image)
- **Size:** Compact (1.5rem padding)
- **Image:** Max 280px width

### Categories
- **Layout:** Horizontal scrollable row
- **Cards:** White background with hover effects
- **Display:** Icon, Category name, Vacancy count

---

## 🔐 Authentication System

### User Types
1. **Job Seekers**
   - Can browse and search jobs
   - Can view job details
   - Can apply via email

2. **Employers**
   - Can post job openings
   - Must login to access Post Job page
   - Can specify vacancies, requirements, deadlines

### Login System
- Single login form with user type selection
- No registration (admin creates accounts)
- Demo accounts available for testing
- Session stored in localStorage
- Automatic redirect based on user type

---

## 📊 Sample Job Data (8 Jobs)

1. **Senior Software Developer** - Tech Solutions Ethiopia (IT, 3 vacancies)
2. **Registered Nurse** - St. Paul's Hospital (Health, 5 vacancies)
3. **Project Manager** - International NGO (NGO, 2 vacancies)
4. **Civil Engineer** - Ethiopian Construction Corp (Engineering, 4 vacancies)
5. **High School Teacher - Mathematics** - Bole International School (Education, 2 vacancies)
6. **Financial Analyst** - Commercial Bank of Ethiopia (Finance, 1 vacancy)
7. **Web Designer** - Digital Media Agency (IT, 2 vacancies)
8. **Medical Doctor** - Hawassa Health Center (Health, 3 vacancies)

---

## 💾 Data Storage

- **Jobs:** Stored in localStorage (key: 'habeshaJobs')
- **Users:** Stored in localStorage (key: 'users')
- **Current User:** Stored in localStorage (key: 'currentUser')
- **Search/Filter State:** Temporary localStorage for page transitions

---

## 📱 Responsive Design

### Desktop (> 768px)
- Full navigation menu
- Two-column hero layout
- Grid layout for job cards
- Sidebar filters

### Mobile (< 768px)
- Hamburger menu
- Single column layout
- Stacked hero content
- Smaller images and text
- Full-width filters

---

## ✨ Key Features

1. **Job Search & Filtering**
   - Search by keyword
   - Filter by category, location, type
   - Sort by newest or deadline

2. **Dynamic Content**
   - Jobs loaded from data
   - Vacancy counts calculated dynamically
   - Deadline countdown

3. **User Experience**
   - Smooth animations
   - Hover effects
   - Loading states
   - Success messages
   - Form validation

4. **Accessibility**
   - Semantic HTML
   - Clear labels
   - Keyboard navigation
   - Readable fonts

---

## 🗂️ File Structure

```
habesha-career/
├── index.html              # Home page
├── jobs.html               # Job listings
├── job-details.html        # Individual job view
├── post-job.html           # Employer job posting
├── about.html              # About page
├── contact.html            # Contact page
├── login.html              # Login page
├── css/
│   └── style.css           # All styles
├── js/
│   ├── auth.js             # Authentication logic
│   ├── data.js             # Job data & storage
│   ├── main.js             # Home page logic
│   ├── jobs.js             # Job listing logic
│   ├── job-details.js      # Job details logic
│   ├── post-job.js         # Job posting logic
│   └── contact.js          # Contact form logic
├── images/
│   ├── logo.png            # Company logo (placeholder)
│   ├── hero-image.png      # Hero section image (placeholder)
│   └── README.txt          # Image instructions
└── README.md               # Project documentation
```

---

## 🚀 How to Use

### For Job Seekers:
1. Visit home page
2. Browse categories or search jobs
3. Click on job to view details
4. Apply via email link

### For Employers:
1. Login with employer credentials
2. Navigate to "Post Job"
3. Fill out job posting form
4. Submit job

### For Admins:
- Manage user accounts manually
- Update job data in localStorage
- Monitor submissions

---

## 🔄 Future Enhancements (Suggested)

1. Backend integration (Node.js, Python, PHP)
2. Database (MongoDB, MySQL, PostgreSQL)
3. User registration system
4. Resume upload functionality
5. Saved/favorite jobs
6. Email notifications
7. Admin dashboard
8. Job application tracking
9. Company profiles
10. Mobile app (Android/iOS)

---

## 📞 Contact Information

- **Email:** info@habeshacareer.com
- **Location:** Addis Ababa, Ethiopia
- **Website:** Habesha Career Platform

---

## 🎯 Target Metrics

- **Job Categories:** 6
- **Sample Jobs:** 8
- **Total Vacancies:** 22 (across all jobs)
- **Pages:** 7
- **User Types:** 2 (Job Seekers, Employers)

---

**Last Updated:** November 19, 2025  
**Version:** 1.0  
**Status:** Production Ready
