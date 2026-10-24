"""What Gemini returns for one chunk, and the merged recipe the app reads."""
from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field


class IngredientUse(BaseModel):
    name: str = Field(description="Ingredient in plain English, e.g. 'garam masala'.")
    said_as: str = Field(description="The cook's exact words for the amount or the ingredient, in the language "
                                     "spoken, e.g. 'thoda sa', 'a handful', 'andaaze se'. Empty if not said.")
    estimated_amount: str = Field(description="Best estimate with units from what is seen and said, "
                                              "e.g. '~1 tbsp'. 'amount not said' if there is no basis.")
    at: str = Field(description="MM:SS in THIS video when it is added.")


class Step(BaseModel):
    start: str = Field(description="MM:SS in this video where the step begins.")
    end: str = Field(description="MM:SS in this video where the step ends.")
    title: str = Field(description="Short imperative title, e.g. 'Fry the onions'.")
    instruction: str = Field(description="What to do, in English, 1-3 sentences, in the cook's spirit.")
    ingredients: List[IngredientUse]
    doneness_cue: str = Field(description="How the cook knows it is done: color, smell, sound, "
                                                       "texture, time. Keep their phrasing.")
    quote_original: str = Field(description="One short line the cook said in this step, verbatim, "
                                                         "in the original language.")
    quote_english: str = Field(description="English translation of quote_original.")
    story: str = Field(description="Any memory, family story or tip told during this step, "
                                                "summarized in English. Empty if none.")
    confidence: float = Field(description="0-1: how sure you are this step and its timing are right.")


class ChunkRecipe(BaseModel):
    dish_guess: str = Field(description="The dish being made, or '' if unclear in this part.")
    steps: List[Step]
    notes: str = Field(description="Anything uncertain: hard-to-hear words, things off camera.")


# ---- merged output (written by merge.py) ----

class RecipeIngredient(BaseModel):
    name: str
    said_as: str
    estimated_amount: str
    first_used_s: float


class RecipeStep(BaseModel):
    index: int
    start_s: float
    end_s: float
    start: str
    title: str
    instruction: str
    ingredients: List[IngredientUse]
    doneness_cue: str = ""
    quote_original: str = ""
    quote_english: str = ""
    story: str = ""
    confidence: float
    source_chunk: int


class Recipe(BaseModel):
    session_id: str
    title: str
    cook_name: str
    relationship: str
    spoken_languages: List[str]
    duration_s: float
    video: str = "full.mp4"
    ingredients: List[RecipeIngredient]
    steps: List[RecipeStep]
    notes: List[str] = Field(default_factory=list)
    consent_recorded_at: str = "00:00"
    license_opt_in: bool = False
    generated_by: Optional[str] = None
