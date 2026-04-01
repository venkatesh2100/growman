// Indian States and Major Cities Data
export interface State {
  name: string;
  code: string;
  cities: string[];
}

export const indianStates: State[] = [
  {
    name: "Andhra Pradesh",
    code: "AP",
    cities: [
      "Visakhapatnam",
      "Vijayawada",
      "Guntur",
      "Nellore",
      "Kurnool",
      "Rajahmundry",
      "Tirupati",
      "Kakinada",
      "Kadapa",
      "Anantapur",
    ],
  },
  {
    name: "Arunachal Pradesh",
    code: "AR",
    cities: ["Itanagar", "Naharlagun", "Pasighat", "Tawang", "Bomdila"],
  },
  {
    name: "Assam",
    code: "AS",
    cities: [
      "Guwahati",
      "Silchar",
      "Dibrugarh",
      "Jorhat",
      "Nagaon",
      "Tinsukia",
      "Tezpur",
      "Bongaigaon",
    ],
  },
  {
    name: "Bihar",
    code: "BR",
    cities: [
      "Patna",
      "Gaya",
      "Bhagalpur",
      "Muzaffarpur",
      "Purnia",
      "Darbhanga",
      "Arrah",
      "Bihar Sharif",
    ],
  },
  {
    name: "Chhattisgarh",
    code: "CT",
    cities: [
      "Raipur",
      "Bhilai",
      "Durg",
      "Bilaspur",
      "Korba",
      "Rajnandgaon",
      "Raigarh",
      "Jagdalpur",
    ],
  },
  {
    name: "Goa",
    code: "GA",
    cities: ["Panaji", "Margao", "Vasco da Gama", "Mapusa", "Ponda"],
  },
  {
    name: "Gujarat",
    code: "GJ",
    cities: [
      "Ahmedabad",
      "Surat",
      "Vadodara",
      "Rajkot",
      "Bhavnagar",
      "Jamnagar",
      "Gandhinagar",
      "Anand",
    ],
  },
  {
    name: "Haryana",
    code: "HR",
    cities: [
      "Faridabad",
      "Gurgaon",
      "Panipat",
      "Ambala",
      "Yamunanagar",
      "Rohtak",
      "Hisar",
      "Karnal",
    ],
  },
  {
    name: "Himachal Pradesh",
    code: "HP",
    cities: [
      "Shimla",
      "Mandi",
      "Solan",
      "Dharamshala",
      "Kullu",
      "Chamba",
      "Bilaspur",
    ],
  },
  {
    name: "Jharkhand",
    code: "JH",
    cities: [
      "Ranchi",
      "Jamshedpur",
      "Dhanbad",
      "Bokaro",
      "Hazaribagh",
      "Deoghar",
      "Giridih",
    ],
  },
  {
    name: "Karnataka",
    code: "KA",
    cities: [
      "Bangalore",
      "Mysore",
      "Hubli",
      "Mangalore",
      "Belgaum",
      "Gulbarga",
      "Davangere",
      "Bellary",
    ],
  },
  {
    name: "Kerala",
    code: "KL",
    cities: [
      "Kochi",
      "Thiruvananthapuram",
      "Kozhikode",
      "Thrissur",
      "Kollam",
      "Alappuzha",
      "Palakkad",
      "Kannur",
    ],
  },
  {
    name: "Madhya Pradesh",
    code: "MP",
    cities: [
      "Indore",
      "Bhopal",
      "Gwalior",
      "Jabalpur",
      "Raipur",
      "Ujjain",
      "Sagar",
      "Dewas",
    ],
  },
  {
    name: "Maharashtra",
    code: "MH",
    cities: [
      "Mumbai",
      "Pune",
      "Nagpur",
      "Nashik",
      "Aurangabad",
      "Solapur",
      "Thane",
      "Kalyan",
    ],
  },
  {
    name: "Manipur",
    code: "MN",
    cities: ["Imphal", "Thoubal", "Kakching", "Ukhrul", "Churachandpur"],
  },
  {
    name: "Meghalaya",
    code: "ML",
    cities: ["Shillong", "Tura", "Jowai", "Nongpoh", "Williamnagar"],
  },
  {
    name: "Mizoram",
    code: "MZ",
    cities: ["Aizawl", "Lunglei", "Saiha", "Champhai", "Kolasib"],
  },
  {
    name: "Nagaland",
    code: "NL",
    cities: ["Kohima", "Dimapur", "Mokokchung", "Tuensang", "Wokha"],
  },
  {
    name: "Odisha",
    code: "OD",
    cities: [
      "Bhubaneswar",
      "Cuttack",
      "Rourkela",
      "Berhampur",
      "Sambalpur",
      "Puri",
      "Baleshwar",
    ],
  },
  {
    name: "Punjab",
    code: "PB",
    cities: [
      "Ludhiana",
      "Amritsar",
      "Jalandhar",
      "Patiala",
      "Bathinda",
      "Pathankot",
      "Hoshiarpur",
    ],
  },
  {
    name: "Rajasthan",
    code: "RJ",
    cities: [
      "Jaipur",
      "Jodhpur",
      "Kota",
      "Bikaner",
      "Ajmer",
      "Udaipur",
      "Bhilwara",
      "Alwar",
    ],
  },
  {
    name: "Sikkim",
    code: "SK",
    cities: ["Gangtok", "Namchi", "Mangan", "Gyalshing", "Singtam"],
  },
  {
    name: "Tamil Nadu",
    code: "TN",
    cities: [
      "Chennai",
      "Coimbatore",
      "Madurai",
      "Tiruchirappalli",
      "Salem",
      "Tirunelveli",
      "Erode",
      "Vellore",
    ],
  },
  {
    name: "Telangana",
    code: "TS",
    cities: [
      "Hyderabad",
      "Warangal",
      "Nizamabad",
      "Karimnagar",
      "Ramagundam",
      "Khammam",
      "Mahbubnagar",
    ],
  },
  {
    name: "Tripura",
    code: "TR",
    cities: ["Agartala", "Udaipur", "Dharmanagar", "Kailasahar", "Belonia"],
  },
  {
    name: "Uttar Pradesh",
    code: "UP",
    cities: [
      "Lucknow",
      "Kanpur",
      "Agra",
      "Varanasi",
      "Allahabad",
      "Meerut",
      "Ghaziabad",
      "Noida",
    ],
  },
  {
    name: "Uttarakhand",
    code: "UK",
    cities: [
      "Dehradun",
      "Haridwar",
      "Roorkee",
      "Haldwani",
      "Rudrapur",
      "Kashipur",
      "Pithoragarh",
    ],
  },
  {
    name: "West Bengal",
    code: "WB",
    cities: [
      "Kolkata",
      "Howrah",
      "Durgapur",
      "Asansol",
      "Siliguri",
      "Bardhaman",
      "Malda",
      "Kharagpur",
    ],
  },
  {
    name: "Andaman and Nicobar Islands",
    code: "AN",
    cities: ["Port Blair", "Car Nicobar", "Mayabunder", "Diglipur"],
  },
  {
    name: "Chandigarh",
    code: "CH",
    cities: ["Chandigarh"],
  },
  {
    name: "Dadra and Nagar Haveli and Daman and Diu",
    code: "DH",
    cities: ["Daman", "Diu", "Silvassa"],
  },
  {
    name: "Delhi",
    code: "DL",
    cities: [
      "New Delhi",
      "North Delhi",
      "South Delhi",
      "East Delhi",
      "West Delhi",
      "Central Delhi",
    ],
  },
  {
    name: "Jammu and Kashmir",
    code: "JK",
    cities: [
      "Srinagar",
      "Jammu",
      "Anantnag",
      "Baramulla",
      "Udhampur",
      "Kathua",
    ],
  },
  {
    name: "Ladakh",
    code: "LA",
    cities: ["Leh", "Kargil"],
  },
  {
    name: "Lakshadweep",
    code: "LD",
    cities: ["Kavaratti", "Agatti", "Amini"],
  },
  {
    name: "Puducherry",
    code: "PY",
    cities: ["Puducherry", "Karaikal", "Mahe", "Yanam"],
  },
];

export function getStateByName(name: string): State | undefined {
  return indianStates.find((state) => state.name === name);
}

export function getCitiesByState(stateName: string): string[] {
  const state = getStateByName(stateName);
  return state ? state.cities : [];
}

export function getAllStateNames(): string[] {
  return indianStates.map((state) => state.name);
}

