import cataclysm from './cataclysm.js';
import gender from './gender.js';
import body_type from './body_type.js';
import profession from './profession.js';
import health from './health.js';
import hobby from './hobby.js';
import trait from './trait.js';
import phobia from './phobia.js';
import backpack from './backpack.js';
import large_inventory from './large_inventory.js';
import extra_info from './extra_info.js';
import special_ability from './special_ability.js';
import food_supply from './food_supply.js';
import location from './location.js';
import history from './history.js';
import rooms_description from './rooms_description.js';
import problems from './problems.js';
import items from './items.js';

export const CATEGORY_PROMPTS = {
  cataclysm,
  gender,
  body_type,
  profession,
  health,
  hobby,
  trait,
  phobia,
  backpack,
  large_inventory,
  extra_info,
  special_ability,
  food_supply,
  location,
  history,
  rooms_description,
  problems,
  items
};

export function getPromptForCategory(category) {
  return CATEGORY_PROMPTS[category] || '';
}

