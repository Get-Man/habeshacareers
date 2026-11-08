const languagesData = [
    "Aari", "Achiote (Aweera)", "Afar", "Agew Awi", "Agew Himra", "Alaba", "Amharic", "Anuak", "Arabic", "Arbore", "Argobba", "Arsi", "Ateso", "Awngi",
    "Baale", "Baiso", "Basketo", "Bench", "Bertha", "Bodi", "Boni", "Burji",
    "Ch Oromo (Harar Oromo)", "Chaha", "Chara", "Chebo", "Cheha", "Chencha", "Chinese",
    "Dawro", "Dime", "Dizi", "Dorze", "Dullay",
    "English",
    "French",
    "Gamo", "Ganza", "Gedeo", "Gewada", "Gofa", "Gumuz", "Gura", "Gurage (cluster)",
    "Hadiyya", "Hamer", "Hamer-Banna", "Harari", "Hausa (minority)",
    "Inor",
    "Kafa", "Kara", "Kembata", "Khamtanga", "Kiswahili", "Kistane", "Komo", "Kono", "Konso", "Kore", "Koyra", "Kunama", "Kwegu",
    "Maale", "Majang", "Me’en", "Menja", "Messmes", "Mursi",
    "Nayi", "Nuer",
    "Oromo (Afaan Oromo)",
    "Portuguese",
    "Qemant",
    "Russian",
    "Saho", "Shekkacho", "Sheko", "Shinasha", "Sidaama", "Silt’e", "Somali", "Spanish", "Surma",
    "T’ena", "Tembaro", "Tigre", "Tigrinya", "Tsamai",
    "Uduk",
    "Wagdi", "Walani", "Walaytta", "Wolane", "Wolaytta",
    "Xamtanga",
    "Yem",
    "Zay", "Zergulla",
    "Other",
];

// Sort alphabetically
languagesData.sort();

// Remove duplicates if any
const uniqueLanguages = [...new Set(languagesData)];
