// Complete Profile JavaScript
let currentSection = 1;
const totalSections = 12;

// Initialize on page load
document.addEventListener('DOMContentLoaded', function () {
    console.log('Complete Profile JS loaded');
    console.log('Countries data available:', typeof countriesData !== 'undefined');
    console.log('Number of countries:', countriesData ? countriesData.length : 0);
    
    if (typeof countriesData === 'undefined') {
        console.error('countriesData is not loaded! Check if countries-data.js is loaded before complete-profile.js');
        return;
    }

    // Populate dropdowns
    populateCountryDropdowns();
    populatePhoneCountryCodes();
    setDefaultCountry('ET');

    // Initialize section navigation
    initializeSectionNavigation();

    // Load saved data if exists
    loadSavedData();

    // Update progress
    updateProgress();

    console.log('Complete Profile initialized');
    console.log('Nationality dropdown options:', document.getElementById('nationality')?.options.length);
    console.log('Phone country code options:', document.getElementById('phoneCountryCode')?.options.length);
});

// Populate nationality and country of residence dropdowns
function populateCountryDropdowns() {
    const nationalitySelect = document.getElementById('nationality');
    const countrySelect = document.getElementById('countryOfResidence');

    if (!nationalitySelect || !countrySelect) return;

    countriesData.forEach(country => {
        // Nationality dropdown
        const nationalityOption = document.createElement('option');
        nationalityOption.value = country.name;
        nationalityOption.textContent = `${country.flag} ${country.name}`;
        nationalitySelect.appendChild(nationalityOption);

        // Country of residence dropdown
        const countryOption = document.createElement('option');
        countryOption.value = country.name;
        countryOption.textContent = `${country.flag} ${country.name}`;
        countryOption.setAttribute('data-code', country.code);
        countrySelect.appendChild(countryOption);
    });
}

// Populate phone country code dropdowns
function populatePhoneCountryCodes() {
    const phoneCountryCode = document.getElementById('phoneCountryCode');
    const altPhoneCountryCode = document.getElementById('altPhoneCountryCode');

    if (!phoneCountryCode) return;

    countriesData.forEach(country => {
        // Primary phone country code
        const option1 = document.createElement('option');
        option1.value = country.code;
        option1.textContent = `${country.flag} ${country.dialCode}`;
        option1.setAttribute('data-dial-code', country.dialCode);
        option1.setAttribute('data-country', country.name);
        phoneCountryCode.appendChild(option1);

        // Alternative phone country code
        if (altPhoneCountryCode) {
            const option2 = document.createElement('option');
            option2.value = country.code;
            option2.textContent = `${country.flag} ${country.dialCode}`;
            option2.setAttribute('data-dial-code', country.dialCode);
            option2.setAttribute('data-country', country.name);
            altPhoneCountryCode.appendChild(option2);
        }
    });
}

// Set default country (Ethiopia)
function setDefaultCountry(countryCode) {
    const phoneCountryCode = document.getElementById('phoneCountryCode');
    const altPhoneCountryCode = document.getElementById('altPhoneCountryCode');
    const countrySelect = document.getElementById('countryOfResidence');
    const nationalitySelect = document.getElementById('nationality');

    if (phoneCountryCode) phoneCountryCode.value = countryCode;
    if (altPhoneCountryCode) altPhoneCountryCode.value = countryCode;

    // Set Ethiopia in country of residence
    if (countrySelect) {
        const ethiopiaOption = Array.from(countrySelect.options).find(
            opt => opt.getAttribute('data-code') === countryCode
        );
        if (ethiopiaOption) countrySelect.value = ethiopiaOption.value;
    }

    // Set Ethiopian in nationality
    if (nationalitySelect) {
        const ethiopianOption = Array.from(nationalitySelect.options).find(
            opt => opt.value === 'Ethiopia'
        );
        if (ethiopianOption) nationalitySelect.value = ethiopianOption.value;
    }
}

// Sync country of residence when phone country code changes
function syncCountryFromPhone() {
    const phoneCountryCode = document.getElementById('phoneCountryCode');
    const countrySelect = document.getElementById('countryOfResidence');

    if (!phoneCountryCode || !countrySelect) return;

    const selectedCode = phoneCountryCode.value;
    const selectedOption = phoneCountryCode.options[phoneCountryCode.selectedIndex];
    const countryName = selectedOption.getAttribute('data-country');

    // Update country of residence to match phone country
    if (countryName) {
        const matchingOption = Array.from(countrySelect.options).find(
            opt => opt.value === countryName
        );
        if (matchingOption) {
            countrySelect.value = matchingOption.value;
        }
    }
}

// Initialize section navigation
function initializeSectionNavigation() {
    const navItems = document.querySelectorAll('.nav-item');

    navItems.forEach((item, index) => {
        item.addEventListener('click', function (e) {
            e.preventDefault();
            const sectionNum = parseInt(this.getAttribute('data-section'));
            if (sectionNum) {
                goToSection(sectionNum);
            }
        });
    });
}

// Navigate to specific section
function goToSection(sectionNum) {
    if (sectionNum < 1 || sectionNum > totalSections) return;

    // Hide all sections
    document.querySelectorAll('.profile-section').forEach(section => {
        section.classList.remove('active');
    });

    // Show target section
    const sections = document.querySelectorAll('.profile-section');
    if (sections[sectionNum - 1]) {
        sections[sectionNum - 1].classList.add('active');
    }

    // Update navigation
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
    });

    const activeNavItem = document.querySelector(`.nav-item[data-section="${sectionNum}"]`);
    if (activeNavItem) {
        activeNavItem.classList.add('active');
        activeNavItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    currentSection = sectionNum;
    updateProgress();
}

// Next section
function nextSection() {
    if (currentSection < totalSections) {
        goToSection(currentSection + 1);
    }
}

// Previous section
function prevSection() {
    if (currentSection > 1) {
        goToSection(currentSection - 1);
    }
}

// Update progress bar
function updateProgress() {
    const form = document.getElementById('completeProfileForm');
    if (!form) return;

    const allInputs = form.querySelectorAll('input[required], select[required], textarea[required]');
    const filledInputs = Array.from(allInputs).filter(input => {
        if (input.type === 'checkbox' || input.type === 'radio') {
            return input.checked;
        }
        return input.value.trim() !== '';
    });

    const percentage = allInputs.length > 0 ? Math.round((filledInputs.length / allInputs.length) * 100) : 0;

    const progressFill = document.getElementById('progressFill');
    const progressPercent = document.getElementById('progressPercent');

    if (progressFill) progressFill.style.width = percentage + '%';
    if (progressPercent) progressPercent.textContent = percentage;

    // Mark completed sections
    markCompletedSections();
}

// Mark completed sections in navigation
function markCompletedSections() {
    const sections = document.querySelectorAll('.profile-section');

    sections.forEach((section, index) => {
        const sectionInputs = section.querySelectorAll('input[required], select[required], textarea[required]');
        const filledInputs = Array.from(sectionInputs).filter(input => {
            if (input.type === 'checkbox' || input.type === 'radio') {
                return input.checked;
            }
            return input.value.trim() !== '';
        });

        const navItem = document.querySelector(`.nav-item[data-section="${index + 1}"]`);
        if (navItem && sectionInputs.length > 0 && filledInputs.length === sectionInputs.length) {
            navItem.classList.add('completed');
        } else if (navItem) {
            navItem.classList.remove('completed');
        }
    });
}

// Save draft
function saveDraft() {
    const formData = collectFormData();
    localStorage.setItem('profileDraft', JSON.stringify(formData));
    
    // Also save to currentUser for CV generation
    const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
    Object.assign(currentUser, formData);
    localStorage.setItem('currentUser', JSON.stringify(currentUser));

    alert('Draft saved successfully! You can generate your CV with the information you\'ve provided so far.');
    updateProgress();
}

// Collect form data
function collectFormData() {
    const form = document.getElementById('completeProfileForm');
    if (!form) return {};

    const formData = {};
    const inputs = form.querySelectorAll('input, select, textarea');

    inputs.forEach(input => {
        if (input.name) {
            if (input.type === 'checkbox') {
                formData[input.name] = input.checked;
            } else if (input.type === 'radio') {
                if (input.checked) {
                    formData[input.name] = input.value;
                }
            } else if (input.tagName === 'SELECT' && input.multiple) {
                formData[input.name] = Array.from(input.selectedOptions).map(option => option.value);
            } else {
                formData[input.name] = input.value;
            }
        }
    });

    return formData;
}

// Load saved data
function loadSavedData() {
    const savedData = localStorage.getItem('profileDraft');
    if (!savedData) return;

    try {
        const data = JSON.parse(savedData);
        const form = document.getElementById('completeProfileForm');
        if (!form) return;

        Object.keys(data).forEach(key => {
            const input = form.querySelector(`[name="${key}"]`);
            if (input) {
                if (input.type === 'checkbox') {
                    input.checked = data[key];
                } else if (input.type === 'radio') {
                    if (input.value === data[key]) {
                        input.checked = true;
                    }
                } else if (input.tagName === 'SELECT' && input.multiple && Array.isArray(data[key])) {
                    Array.from(input.options).forEach(option => {
                        option.selected = data[key].includes(option.value);
                    });
                } else {
                    input.value = data[key];
                }
            }
        });

        updateProgress();
    } catch (e) {
        console.error('Error loading saved data:', e);
    }
}

// Form submission
document.addEventListener('DOMContentLoaded', function () {
    const form = document.getElementById('completeProfileForm');
    if (!form) return;

    form.addEventListener('submit', function (e) {
        e.preventDefault();

        const formData = collectFormData();

        // Save to localStorage
        localStorage.setItem('userProfile', JSON.stringify(formData));

        alert('Profile submitted successfully!');

        // Redirect to profile page
        window.location.href = 'profile.html';
    });

    // Auto-save on input change
    form.addEventListener('input', function () {
        updateProgress();
    });
});

// Add Education
function addEducation() {
    const educationList = document.getElementById('educationList');
    if (!educationList) return;

    // Create unique ID for this education entry
    const uniqueId = Date.now();

    // Create options string for institutions
    let institutionOptions = '<option value="">Select Institution</option>';
    if (typeof uniqueInstitutions !== 'undefined') {
        uniqueInstitutions.forEach(institution => {
            institutionOptions += `<option value="${institution}">${institution}</option>`;
        });
    }

    const educationItem = document.createElement('div');
    educationItem.className = 'list-item';
    educationItem.innerHTML = `
        <div class="list-item-header">
            <span class="list-item-title">Education Entry</span>
            <button type="button" class="btn-remove" onclick="this.parentElement.parentElement.remove(); updateProgress();">Remove</button>
        </div>
        <div class="form-grid-2">
            <div class="form-group">
                <label>Institution</label>
                <select name="institution[]" class="institution-select" data-id="${uniqueId}" onchange="toggleOtherInstitution(this)" required>
                    ${institutionOptions}
                </select>
                <input type="text" name="institutionOther[]" class="institution-other-input" id="institutionOther_${uniqueId}" placeholder="Enter institution name" style="display: none; margin-top: 0.5rem;">
            </div>
            <div class="form-group">
                <label>Degree</label>
                <select name="degree[]" required>
                    <option value="">Select Degree</option>
                    <option value="Certificate">Certificate</option>
                    <option value="Diploma">Diploma</option>
                    <option value="Higher Diploma">Higher Diploma</option>
                    <option value="Associate Degree">Associate Degree</option>
                    <option value="Bachelor's Degree">Bachelor's Degree (BA, BSc, BEng, BCom, BEd, MBBS, etc.)</option>
                    <option value="Master's Degree">Master's Degree (MA, MSc, MBA, MEng, MEd, MPH, etc.)</option>
                    <option value="Postgraduate Diploma">Postgraduate Diploma</option>
                    <option value="Doctorate">Doctorate (PhD, MD, EdD, DDS, DVM, etc.)</option>
                </select>
            </div>
        </div>
        <div class="form-grid-2">
            <div class="form-group">
                <label>Field of Study</label>
                <select name="fieldOfStudy[]" class="field-select" data-id="${uniqueId}" onchange="toggleOtherField(this)" required>
                    <option value="">Select Field of Study</option>
                    ${typeof fieldsOfStudyData !== 'undefined' ? fieldsOfStudyData.map(field => `<option value="${field}">${field}</option>`).join('') : ''}
                </select>
                <input type="text" name="fieldOther[]" class="field-other-input" id="fieldOther_${uniqueId}" placeholder="Enter your field of study" style="display: none; margin-top: 0.5rem;">
            </div>
            <div class="form-group">
                <label>Grade/GPA</label>
                <input type="text" name="grade[]" placeholder="e.g., 3.8/4.0">
            </div>
        </div>
        <div class="form-grid-2">
            <div class="form-group">
                <label>Start Date</label>
                <input type="month" name="eduStartDate[]">
            </div>
            <div class="form-group">
                <label>End Date</label>
                <input type="month" name="eduEndDate[]">
            </div>
        </div>
    `;

    educationList.appendChild(educationItem);
    updateProgress();
}

// Toggle "Other" institution text input
function toggleOtherInstitution(selectElement) {
    const uniqueId = selectElement.getAttribute('data-id');
    const otherInput = document.getElementById(`institutionOther_${uniqueId}`);

    if (selectElement.value === 'Other') {
        otherInput.style.display = 'block';
        otherInput.required = true;
    } else {
        otherInput.style.display = 'none';
        otherInput.required = false;
        otherInput.value = '';
    }
    updateProgress();
}

// Add Experience
function addExperience() {
    const experienceList = document.getElementById('experienceList');
    if (!experienceList) return;

    const experienceItem = document.createElement('div');
    experienceItem.className = 'list-item';
    experienceItem.innerHTML = `
        <div class="list-item-header">
            <span class="list-item-title">Work Experience</span>
            <button type="button" class="btn-remove" onclick="this.parentElement.parentElement.remove(); updateProgress();">Remove</button>
        </div>
        <div class="form-grid-2">
            <div class="form-group">
                <label>Company</label>
                <input type="text" name="company[]" placeholder="Company name">
            </div>
            <div class="form-group">
                <label>Position</label>
                <input type="text" name="position[]" placeholder="Job title">
            </div>
        </div>
        <div class="form-grid-2">
            <div class="form-group">
                <label>Start Date</label>
                <input type="month" name="expStartDate[]">
            </div>
            <div class="form-group">
                <label>End Date</label>
                <input type="month" name="expEndDate[]">
            </div>
        </div>
        <div class="form-group">
            <label>Description</label>
            <textarea name="expDescription[]" rows="3" placeholder="Describe your responsibilities..."></textarea>
        </div>
    `;

    experienceList.appendChild(experienceItem);
    updateProgress();
}

// Add Language
function addLanguage() {
    const languagesList = document.getElementById('languagesList');
    if (!languagesList) return;

    // Create options string
    let languageOptions = '<option value="">Select Language</option>';
    if (typeof uniqueLanguages !== 'undefined') {
        uniqueLanguages.forEach(lang => {
            languageOptions += `<option value="${lang}">${lang}</option>`;
        });
    }

    const languageItem = document.createElement('div');
    languageItem.className = 'list-item';
    languageItem.innerHTML = `
        <div class="list-item-header">
            <span class="list-item-title">Language</span>
            <button type="button" class="btn-remove" onclick="this.parentElement.parentElement.remove(); updateProgress();">Remove</button>
        </div>
        <div class="form-grid-2">
            <div class="form-group">
                <label>Language</label>
                <select name="language[]" required>
                    ${languageOptions}
                </select>
            </div>
            <div class="form-group">
                <label>Proficiency</label>
                <select name="languageProficiency[]" required>
                    <option value="">Select Level</option>
                    <option value="Native">Native</option>
                    <option value="Fluent">Fluent</option>
                    <option value="Advanced">Advanced</option>
                    <option value="Intermediate">Intermediate</option>
                    <option value="Basic">Basic</option>
                </select>
            </div>
        </div>
    `;

    languagesList.appendChild(languageItem);
    updateProgress();
}

// Add Project
function addProject() {
    const projectsList = document.getElementById('projectsList');
    if (!projectsList) return;

    const projectItem = document.createElement('div');
    projectItem.className = 'list-item';
    projectItem.innerHTML = `
        <div class="list-item-header">
            <span class="list-item-title">Project</span>
            <button type="button" class="btn-remove" onclick="this.parentElement.parentElement.remove(); updateProgress();">Remove</button>
        </div>
        <div class="form-group">
            <label>Project Name</label>
            <input type="text" name="projectName[]" placeholder="Project title">
        </div>
        <div class="form-group">
            <label>Description</label>
            <textarea name="projectDescription[]" rows="3" placeholder="Describe the project..."></textarea>
        </div>
        <div class="form-group">
            <label>Project URL</label>
            <input type="url" name="projectUrl[]" placeholder="https://...">
        </div>
    `;

    projectsList.appendChild(projectItem);
    updateProgress();
}

// Add Reference
function addReference() {
    const referencesList = document.getElementById('referencesList');
    if (!referencesList) return;

    const referenceItem = document.createElement('div');
    referenceItem.className = 'list-item';
    referenceItem.innerHTML = `
        <div class="list-item-header">
            <span class="list-item-title">Reference</span>
            <button type="button" class="btn-remove" onclick="this.parentElement.parentElement.remove(); updateProgress();">Remove</button>
        </div>
        <div class="form-grid-2">
            <div class="form-group">
                <label>Name</label>
                <input type="text" name="refName[]" placeholder="Full name">
            </div>
            <div class="form-group">
                <label>Position</label>
                <input type="text" name="refPosition[]" placeholder="Job title">
            </div>
        </div>
        <div class="form-grid-2">
            <div class="form-group">
                <label>Organization</label>
                <input type="text" name="refOrganization[]" placeholder="Company name">
            </div>
            <div class="form-group">
                <label>Phone</label>
                <input type="tel" name="refPhone[]" placeholder="Phone number">
            </div>
        </div>
        <div class="form-group">
            <label>Email</label>
            <input type="email" name="refEmail[]" placeholder="email@example.com">
        </div>
    `;

    referencesList.appendChild(referenceItem);
    updateProgress();
}

// Add Certification
function addCertification() {
    const certificationsList = document.getElementById('certificationsList');
    if (!certificationsList) return;

    const certificationItem = document.createElement('div');
    certificationItem.className = 'list-item';
    certificationItem.innerHTML = `
        <div class="list-item-header">
            <span class="list-item-title">Certification</span>
            <button type="button" class="btn-remove" onclick="this.parentElement.parentElement.remove(); updateProgress();">Remove</button>
        </div>
        <div class="form-grid-2">
            <div class="form-group">
                <label>Certification Name</label>
                <input type="text" name="certName[]" placeholder="Certification title">
            </div>
            <div class="form-group">
                <label>Issuing Organization</label>
                <input type="text" name="certOrganization[]" placeholder="Organization name">
            </div>
        </div>
        <div class="form-grid-2">
            <div class="form-group">
                <label>Issue Date</label>
                <input type="month" name="certIssueDate[]">
            </div>
            <div class="form-group">
                <label>Expiry Date</label>
                <input type="month" name="certExpiryDate[]">
            </div>
        </div>
        <div class="form-group">
            <label>Credential URL</label>
            <input type="url" name="certUrl[]" placeholder="https://...">
        </div>
    `;

    certificationsList.appendChild(certificationItem);
    updateProgress();
}

// Skills functionality (if skills-data.js is available)
if (typeof skillsData !== 'undefined') {
    function filterSkills() {
        const searchInput = document.getElementById('skillSearch');
        const dropdown = document.getElementById('skillsDropdown');

        if (!searchInput || !dropdown) return;

        const searchTerm = searchInput.value.toLowerCase();
        dropdown.innerHTML = '';

        if (searchTerm.length < 1) {
            dropdown.style.display = 'none';
            return;
        }

        const filteredSkills = skillsData.filter(skill =>
            skill.toLowerCase().includes(searchTerm)
        ).slice(0, 10);

        if (filteredSkills.length === 0) {
            dropdown.style.display = 'none';
            return;
        }

        filteredSkills.forEach(skill => {
            const skillItem = document.createElement('div');
            skillItem.className = 'skill-item';
            skillItem.textContent = skill;
            skillItem.onclick = () => addSkill(skill);
            dropdown.appendChild(skillItem);
        });

        dropdown.style.display = 'block';
    }

    function showSkillsDropdown() {
        filterSkills();
    }

    function addSkill(skillName) {
        const skillsList = document.getElementById('skillsList');
        if (!skillsList) return;

        // Check if skill already exists
        const existingSkills = Array.from(skillsList.querySelectorAll('.skill-tag')).map(
            tag => tag.textContent.replace('×', '').trim()
        );

        if (existingSkills.includes(skillName)) {
            return;
        }

        const skillTag = document.createElement('span');
        skillTag.className = 'skill-tag';
        skillTag.innerHTML = `
            ${skillName}
            <button type="button" onclick="this.parentElement.remove(); updateProgress();">×</button>
        `;

        skillsList.appendChild(skillTag);

        // Clear search
        const searchInput = document.getElementById('skillSearch');
        const dropdown = document.getElementById('skillsDropdown');
        if (searchInput) searchInput.value = '';
        if (dropdown) dropdown.style.display = 'none';

        updateProgress();
    }
}


// ============================================
// SAVED JOBS, APPLICATIONS, AND CV FUNCTIONALITY
// ============================================

// Load Saved Jobs
function loadSavedJobs() {
    const savedJobIds = JSON.parse(localStorage.getItem('savedJobs') || '[]');
    const container = document.getElementById('savedJobsList');
    
    if (!container) return;
    
    if (savedJobIds.length === 0) {
        container.innerHTML = `
            <div class="empty-state-card">
                <svg viewBox="0 0 24 24" width="64" height="64" fill="currentColor">
                    <path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z"/>
                </svg>
                <h4>No Saved Jobs</h4>
                <p>You haven't saved any jobs yet. Browse available positions and bookmark your favorites!</p>
                <a href="jobs.html" class="btn-primary">Browse Jobs</a>
            </div>
        `;
        return;
    }
    
    // Get all jobs from data.js
    const allJobs = typeof jobsData !== 'undefined' ? jobsData : [];
    const savedJobs = allJobs.filter(job => savedJobIds.includes(job.id));
    
    container.innerHTML = savedJobs.map(job => `
        <div class="saved-job-item">
            <div class="job-info">
                <h4>${job.title}</h4>
                <p>${job.company}</p>
                <div class="job-meta">
                    <span>📍 ${job.location}</span>
                    <span>💼 ${job.type}</span>
                </div>
            </div>
            <div class="job-actions">
                <a href="job-details.html?id=${job.id}" class="btn-primary">View</a>
                <button onclick="unsaveJob(${job.id})" class="btn-secondary">Remove</button>
            </div>
        </div>
    `).join('');
}

// Unsave a job
function unsaveJob(jobId) {
    let savedJobs = JSON.parse(localStorage.getItem('savedJobs') || '[]');
    savedJobs = savedJobs.filter(id => id !== jobId);
    localStorage.setItem('savedJobs', JSON.stringify(savedJobs));
    loadSavedJobs();
}

// Load Applications
function loadApplications() {
    const applications = JSON.parse(localStorage.getItem('applications') || '[]');
    const container = document.getElementById('applicationsList');
    
    if (!container) return;
    
    if (applications.length === 0) {
        container.innerHTML = `
            <div class="empty-state-card">
                <svg viewBox="0 0 24 24" width="64" height="64" fill="currentColor">
                    <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zM6 20V4h7v5h5v11H6z"/>
                </svg>
                <h4>No Applications Yet</h4>
                <p>You haven't applied to any jobs yet. Start applying to positions that match your skills!</p>
                <a href="jobs.html" class="btn-primary">Browse Jobs</a>
            </div>
        `;
        return;
    }
    
    container.innerHTML = applications.map((app, index) => `
        <div class="application-item">
            <div class="application-info">
                <h4>${app.jobTitle}</h4>
                <p>${app.company}</p>
                <p><small>Applied on: ${new Date(app.appliedDate).toLocaleDateString()}</small></p>
            </div>
            <div class="application-status ${app.status || 'pending'}">
                ${app.status || 'Pending'}
            </div>
        </div>
    `).join('');
}

// Load CV List
function loadCVList() {
    const cvList = JSON.parse(localStorage.getItem('cvList') || '[]');
    const container = document.getElementById('uploadedCVList');
    
    if (!container) return;
    
    if (cvList.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #666;">No CVs uploaded yet.</p>';
        return;
    }
    
    container.innerHTML = cvList.map((cv, index) => `
        <div class="cv-item">
            <div class="cv-info">
                <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
                    <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>
                </svg>
                <div>
                    <strong>${cv.name}</strong>
                    <p>Uploaded: ${new Date(cv.uploadDate).toLocaleDateString()}</p>
                </div>
            </div>
            <button onclick="deleteCVFile(${index})" class="btn-delete">Delete</button>
        </div>
    `).join('');
}

// Handle CV file upload
function handleCVUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const cvList = JSON.parse(localStorage.getItem('cvList') || '[]');
    cvList.push({
        name: file.name,
        size: file.size,
        type: file.type,
        uploadDate: new Date().toISOString()
    });
    
    localStorage.setItem('cvList', JSON.stringify(cvList));
    loadCVList();
    alert('CV uploaded successfully!');
}

// Delete CV file
function deleteCVFile(index) {
    if (!confirm('Are you sure you want to delete this CV?')) return;
    
    const cvList = JSON.parse(localStorage.getItem('cvList') || '[]');
    cvList.splice(index, 1);
    localStorage.setItem('cvList', JSON.stringify(cvList));
    loadCVList();
}

// Upload from Google Drive (placeholder)
function uploadFromGoogleDrive() {
    alert('Google Drive integration coming soon!');
}

// Initialize tabs when switching
function switchTab(tabName) {
    // Hide all tab contents
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
    });
    
    // Remove active class from all tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // Show selected tab
    const selectedTab = document.getElementById(tabName);
    if (selectedTab) {
        selectedTab.classList.add('active');
    }
    
    // Add active class to clicked button
    event.target.closest('.tab-btn')?.classList.add('active');
    
    // Load data for specific tabs
    if (tabName === 'savedJobs') {
        loadSavedJobs();
    } else if (tabName === 'myApplications') {
        loadApplications();
    } else if (tabName === 'myCV') {
        loadCVList();
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', function() {
    // Load initial data for visible tabs
    if (document.getElementById('savedJobsList')) {
        loadSavedJobs();
    }
    if (document.getElementById('applicationsList')) {
        loadApplications();
    }
    if (document.getElementById('uploadedCVList')) {
        loadCVList();
    }
});


// Toggle "Other" institution input
function toggleOtherInstitution(selectElement) {
    const dataId = selectElement.getAttribute('data-id');
    const otherInput = document.getElementById(`institutionOther_${dataId}`);
    
    if (selectElement.value === 'Other') {
        otherInput.style.display = 'block';
        otherInput.required = true;
    } else {
        otherInput.style.display = 'none';
        otherInput.required = false;
        otherInput.value = '';
    }
}

// Toggle "Other" field of study input
function toggleOtherField(selectElement) {
    const dataId = selectElement.getAttribute('data-id');
    const otherInput = document.getElementById(`fieldOther_${dataId}`);
    
    if (selectElement.value === 'Other') {
        otherInput.style.display = 'block';
        otherInput.required = true;
    } else {
        otherInput.style.display = 'none';
        otherInput.required = false;
        otherInput.value = '';
    }
}
