// Sample catalog for a fresh database: one seller, one buyer, an admin, and a Neem plant with sizes.
// A setup script calls ensureSampleData. It upserts rows, so running it twice does not duplicate the plant.
// Returns the seller user. Existing reviews are left alone. Existing sizes and attributes are updated.

import {
  Attribute,
  Brand,
  Category,
  Product,
  ProductSize,
  Review,
  Subcategory,
  User,
} from "../internal/models/index.js";

// Find the user by email or create them, then refresh the name and role. Returns the user row.
async function upsertUser(email, name, role) {
  const [user] = await User.findOrCreate({ where: { email }, defaults: { email, name, role } });
  await user.update({ name, role });
  return user;
}

// Find a category or brand by slug, or create it, then write the latest fields. Returns the row.
async function upsertBySlug(Model, slug, fields) {
  const [row] = await Model.findOrCreate({ where: { slug }, defaults: { slug, ...fields } });
  await row.update(fields);
  return row;
}

// Inserts the demo shop if it is missing and refreshes the Neem listing. Called by the seed script.
export async function ensureSampleData() {
  console.log("seeding sample data for node-backend...");

  const seller = await upsertUser("seller@example.com", "Seller", "SELLER");
  const buyer = await upsertUser("buyer@example.com", "Buyer", "BUYER");
  await upsertUser("admin@example.com", "Admin", "ADMIN");

  const outdoor = await upsertBySlug(Category, "outdoor-plants", {
    name: "Outdoor Plants",
    description: "Plants suited for outdoor spaces",
  });
  const indoor = await upsertBySlug(Category, "indoor-plants", {
    name: "Indoor Plants",
    description: "Great for low to medium light",
  });

  // Subcategories are unique per parent category, not by slug alone.
  const [large] = await Subcategory.findOrCreate({
    where: { slug: "large-plants", categoryId: outdoor.id },
    defaults: { slug: "large-plants", categoryId: outdoor.id, name: "Large Plants", description: "Tall, statement outdoor plants" },
  });
  await large.update({ name: "Large Plants", description: "Tall, statement outdoor plants" });

  const [air] = await Subcategory.findOrCreate({
    where: { slug: "air-purifying", categoryId: indoor.id },
    defaults: { slug: "air-purifying", categoryId: indoor.id, name: "Air Purifying", description: "Filters indoor air" },
  });
  await air.update({ name: "Air Purifying", description: "Filters indoor air" });

  const greenlife = await upsertBySlug(Brand, "greenlife", { name: "GreenLife" });
  await upsertBySlug(Brand, "plant-paradise", { name: "Plant Paradise" });
  await upsertBySlug(Brand, "flora-gardens", { name: "Flora Gardens" });

  const productFields = {
    name: "Neem Plant (Azadirachta indica)",
    description: "Large medicinal plant with natural pest resistance",
    shortDesc: "Large medicinal plant with natural pest resistance",
    fullDesc: "The Neem plant is known for its medicinal properties and natural pest resistance. This large specimen comes in a 12-inch pot and stands 3-4 feet tall. Ideal for outdoor gardens in warm climates.",
    specifications: "Height: 3-4 ft | Pot: 12 in | Light: Full sun | Water: Moderate | Care: Easy",
    taxInfo: "Inclusive of all taxes",
    price: 499,
    mrp: 799,
    currency: "INR",
    imageKey: "https://m.media-amazon.com/images/I/41cUNNALHWL.jpg",
    status: "active",
    featured: true,
    tags: ["neem", "outdoor", "large", "medicinal"],
    stock: 20,
    categoryId: outdoor.id,
    subcategoryId: large.id,
    brandId: greenlife.id,
  };
  const [neem, created] = await Product.findOrCreate({
    where: { slug: "neem-plant" },
    defaults: { slug: "neem-plant", ...productFields },
  });
  // Do not overwrite a photo the shop already uploaded. Only fill the image when the row has none.
  if (!created && !neem.imageKey) await neem.update({ imageKey: productFields.imageKey });

  const sizes = [
    {
      label: "Small (1-2 ft)",
      price: 299,
      stock: 10,
      imageKeys: ["https://m.media-amazon.com/images/I/41cUNNALHWL.jpg", "https://m.media-amazon.com/images/I/713i7wgMS2L._SL1000_.jpg"],
    },
    {
      label: "Medium (2-3 ft)",
      price: 499,
      stock: 15,
      imageKeys: ["https://www.toothmountainnursery.com/wp-content/uploads/2020/03/Neem.jpg"],
    },
    {
      label: "Large (3-4 ft)",
      price: 799,
      stock: 5,
      imageKeys: ["https://m.media-amazon.com/images/I/517SDVgeO2L.jpg"],
    },
  ];
  // Match a size by its label on this product. Update price and stock if it already exists.
  for (const size of sizes) {
    const existing = await ProductSize.findOne({ where: { productId: neem.id, label: size.label } });
    if (existing) {
      await existing.update({ price: size.price, stock: size.stock, imageKeys: size.imageKeys });
      continue;
    }
    await ProductSize.create({ ...size, productId: neem.id });
  }

  const attrs = [
    { name: "Plant Type", value: "Tree" },
    { name: "Growth Rate", value: "Fast" },
    { name: "Flowering", value: "Seasonal" },
    { name: "Air Purifying", value: "Yes" },
  ];
  for (const attr of attrs) {
    const existing = await Attribute.findOne({ where: { productId: neem.id, name: attr.name } });
    if (existing) {
      await existing.update({ value: attr.value });
      continue;
    }
    await Attribute.create({ ...attr, productId: neem.id });
  }

  const reviews = [
    { rating: 5, comment: "Arrived in perfect condition. Growing well after 2 months." },
    { rating: 4, comment: "Good quality, slight shipping damage but recovered quickly." },
  ];
  // Skip a review that is already stored for this buyer and rating. Do not edit a real customer's words.
  for (const review of reviews) {
    const existing = await Review.findOne({
      where: { productId: neem.id, userId: buyer.id, rating: review.rating },
    });
    if (existing) continue;
    await Review.create({ ...review, productId: neem.id, userId: buyer.id });
  }

  return seller;
}
