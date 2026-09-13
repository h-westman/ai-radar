CORE = "Core"
HIDDEN_GEM = "Hidden gem"
QUESTION_IT = "Question it"
PARKED = "Parked"


def corner_label(adoption: int, value: int) -> str:
    high_adoption = adoption >= 50
    if value >= 50:
        return CORE if high_adoption else HIDDEN_GEM
    return QUESTION_IT if high_adoption else PARKED
